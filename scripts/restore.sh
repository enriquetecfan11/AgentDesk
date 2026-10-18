#!/usr/bin/env bash
#
# Restaura una copia hecha con scripts/backup.sh.
#
#   ./scripts/restore.sh backups/agentdesk-2026-01-31-0912.tar.gz
#   FORCE=1 ./scripts/restore.sh copia.tar.gz      # sin preguntar
#
# Qué hace, en este orden y por este motivo:
#
#   1. Extrae el .tar.gz a un directorio temporal.
#   2. Para la app. Sin esto no se puede borrar la base de datos: la app tiene
#      conexiones abiertas.
#   3. Recrea la base de datos vacía y carga db.sql.
#   4. Arranca la app de nuevo (las migraciones del entrypoint son idempotentes).
#   5. Vacía el volumen "uploads" y descomprime el contenido de uploads.tar.
#
# Es DESTRUCTIVO: lo que hubiera en la base de datos y en los artefactos se
# pierde. Deja una copia de seguridad del estado actual antes de tocar nada.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Argumentos
# ---------------------------------------------------------------------------

ARCHIVE="${1:-}"

if [ -z "$ARCHIVE" ] || [ "$ARCHIVE" = "-h" ] || [ "$ARCHIVE" = "--help" ]; then
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

[ -f "$ARCHIVE" ] || { printf 'Error: no existe %s\n' "$ARCHIVE" >&2; exit 1; }

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-agentdesk}"
POSTGRES_DB="${POSTGRES_DB:-agentdesk}"

info() { printf '  %s\n' "$1"; }
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }

command -v docker > /dev/null || fail "no encuentro docker en el PATH"

docker compose ps --status running --services 2> /dev/null | grep -qx db \
  || fail "el contenedor 'db' no está en marcha. Levanta el stack con: docker compose up -d"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

printf '\nExtrayendo %s…\n' "$ARCHIVE"
tar -xzf "$ARCHIVE" -C "$TMP"

[ -s "$TMP/db.sql" ] || fail "la copia no contiene db.sql"
[ -f "$TMP/uploads.tar" ] || fail "la copia no contiene uploads.tar"

if [ "${FORCE:-0}" != "1" ]; then
  printf '\n'
  [ -f "$TMP/meta.txt" ] && sed 's/^/  /' "$TMP/meta.txt" && printf '\n'
  printf 'Se van a BORRAR la base de datos «%s» y los artefactos actuales.\n' "$POSTGRES_DB"
  printf '¿Seguro? (escribe "si" para continuar) '
  read -r answer
  [ "$answer" = "si" ] || { printf 'Cancelado.\n'; exit 1; }
fi

# Red de seguridad: si algo se tuerce a mitad, hay una copia del estado actual.
SAFETY_DIR="./backups"
mkdir -p "$SAFETY_DIR"
SAFETY="$SAFETY_DIR/pre-restore-$(date +%Y-%m-%d-%H%M).tar.gz"
info "copia de seguridad del estado actual → $SAFETY"
BACKUP_FILE="$SAFETY" ./scripts/backup.sh > /dev/null

# ---------------------------------------------------------------------------
# Base de datos
# ---------------------------------------------------------------------------

info "parando la app…"
docker compose stop app > /dev/null

info "recreando la base de datos…"
docker compose exec -T db psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$POSTGRES_DB\"" > /dev/null

info "cargando el volcado…"
docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q \
  < "$TMP/db.sql" > /dev/null

info "arrancando la app…"
docker compose up -d app > /dev/null

# ---------------------------------------------------------------------------
# Artefactos
# ---------------------------------------------------------------------------

info "restaurando los artefactos…"
docker compose exec -T app sh -c 'find /app/uploads -mindepth 1 -delete' \
  && docker compose exec -T app tar -xf - -C /app < "$TMP/uploads.tar"

# ---------------------------------------------------------------------------
# Comprobación
# ---------------------------------------------------------------------------

info "esperando a que la app responda…"
HEALTHY=""
for _ in $(seq 1 40); do
  STATE="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2> /dev/null || echo '')"
  if [ "$STATE" = "healthy" ]; then HEALTHY="sí"; break; fi
  sleep 3
done

printf '\n'
if [ -n "$HEALTHY" ]; then
  printf 'Restauración completada. La app está healthy.\n'
else
  printf 'La restauración terminó, pero la app aún no está healthy.\n'
  printf 'Mira los logs: docker compose logs --tail=50 app\n'
fi
printf 'Copia del estado anterior: %s\n\n' "$SAFETY"
