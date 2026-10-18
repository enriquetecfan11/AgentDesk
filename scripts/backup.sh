#!/usr/bin/env bash
#
# Copia de seguridad de AgentDesk: base de datos + artefactos.
#
#   ./scripts/backup.sh                 → backups/agentdesk-AAAA-MM-DD-HHMM.tar.gz
#   BACKUP_DIR=/ruta ./scripts/backup.sh
#
# El .tar.gz lleva tres ficheros:
#
#   meta.txt      qué se copió y cuándo (informativo)
#   db.sql        volcado SQL de Postgres (legible, restaurable con psql)
#   uploads.tar   el volumen "uploads" tal cual
#
# Se usa volcado en SQL plano, no en formato binario, porque es lo que se puede
# abrir, revisar y restaurar en cualquier Postgres de la misma versión o
# posterior —incluido el de Proxmox— sin depender de `pg_restore`.
#
# Restaurar: ./scripts/restore.sh backups/agentdesk-….tar.gz
#
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-agentdesk}"
POSTGRES_DB="${POSTGRES_DB:-agentdesk}"
APP_BASE_URL="${APP_BASE_URL:-?}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

STAMP="$(date +%Y-%m-%d-%H%M)"
# BACKUP_FILE permite elegir el destino exacto; lo usa restore.sh para su copia
# de seguridad previa.
FILE="${BACKUP_FILE:-$BACKUP_DIR/agentdesk-$STAMP.tar.gz}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

info()  { printf '  %s\n' "$1"; }
fail()  { printf 'Error: %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Comprobaciones
# ---------------------------------------------------------------------------

command -v docker > /dev/null || fail "no encuentro docker en el PATH"

docker compose ps --status running --services 2> /dev/null | grep -qx db \
  || fail "el contenedor 'db' no está en marcha. Levanta el stack con: docker compose up -d"

docker compose ps --status running --services 2> /dev/null | grep -qx app \
  || fail "el contenedor 'app' no está en marcha. Levanta el stack con: docker compose up -d"

mkdir -p "$BACKUP_DIR"

printf '\nCopiando AgentDesk (%s)\n' "$STAMP"

# ---------------------------------------------------------------------------
# Base de datos
# ---------------------------------------------------------------------------

info "volcando Postgres…"
docker compose exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges \
  > "$TMP/db.sql"

[ -s "$TMP/db.sql" ] || fail "el volcado de Postgres salió vacío"

# ---------------------------------------------------------------------------
# Artefactos
# ---------------------------------------------------------------------------

info "empaquetando el volumen 'uploads'…"
docker compose exec -T app tar -cf - -C /app uploads > "$TMP/uploads.tar"

# ---------------------------------------------------------------------------
# Metadatos y empaquetado final
# ---------------------------------------------------------------------------

POSTGRES_VERSION="$(docker compose exec -T db postgres --version 2> /dev/null | tr -d '\r' || echo 'desconocida')"

cat > "$TMP/meta.txt" <<META
AgentDesk — copia de seguridad
Fecha:            $(date -u '+%Y-%m-%dT%H:%M:%SZ')
APP_BASE_URL:     $APP_BASE_URL
Base de datos:    $POSTGRES_DB (usuario $POSTGRES_USER)
$POSTGRES_VERSION
Contenido:        db.sql (volcado SQL), uploads.tar (volumen de artefactos)
META

info "comprimiendo…"
tar -czf "$FILE" -C "$TMP" meta.txt db.sql uploads.tar

SIZE="$(du -h "$FILE" | cut -f1 | tr -d ' ')"
printf '\nListo: %s (%s)\n' "$FILE" "$SIZE"
printf 'Restaurar con: ./scripts/restore.sh %s\n\n' "$FILE"
