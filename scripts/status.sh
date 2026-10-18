#!/usr/bin/env bash
#
# En qué estado está AgentDesk.
#
#   ./scripts/status.sh
#
# Muestra los contenedores, si el healthcheck está bien, la URL de acceso, si
# ya hay usuario creado y cuánto hay dentro (tareas, notas, agentes, runs…).
# No cambia nada: es solo leer.
#
set -euo pipefail

cd "$(dirname "$0")/.."

info() { printf '  %s\n' "$1"; }
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

command -v docker > /dev/null || fail "no encuentro docker en el PATH"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

APP_BASE_URL="${APP_BASE_URL:-?}"
POSTGRES_USER="${POSTGRES_USER:-agentdesk}"
POSTGRES_DB="${POSTGRES_DB:-agentdesk}"

printf '\n\033[1mAgentDesk\033[0m — estado\n'

# ---------------------------------------------------------------------------
# Contenedores
# ---------------------------------------------------------------------------

step "Contenedores"
if [ -z "$(docker compose ps -q 2> /dev/null || true)" ]; then
  info "ninguno arrancado. Levántalo con: ./scripts/start.sh"
  printf '\n'
  exit 0
fi

docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}' 2> /dev/null \
  || docker compose ps

# ---------------------------------------------------------------------------
# Healthcheck
# ---------------------------------------------------------------------------

step "Healthcheck"
for service in db app; do
  id="$(docker compose ps -q "$service" 2> /dev/null || true)"
  if [ -z "$id" ]; then
    info "$service: no está arrancado"
    continue
  fi
  state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2> /dev/null || echo 'sin healthcheck')"
  info "$service: $state"
done

# ---------------------------------------------------------------------------
# Acceso
# ---------------------------------------------------------------------------

step "Acceso"
info "URL base: $APP_BASE_URL"

if command -v curl > /dev/null; then
  health="$(curl -fsS --max-time 8 "$APP_BASE_URL/api/health" 2> /dev/null || true)"
  if printf '%s' "$health" | grep -q '"status":"ok"'; then
    info "/api/health: ok"
  else
    info "/api/health: no responde en $APP_BASE_URL"
    info "  (si estás en otra máquina, prueba a abrir la URL en el navegador)"
  fi
fi

# ---------------------------------------------------------------------------
# Contenido
# ---------------------------------------------------------------------------

step "Contenido"

QUERY="select
  (select count(*) from users)    as usuarios,
  (select count(*) from tasks)    as tareas,
  (select count(*) from projects) as proyectos,
  (select count(*) from notes)    as notas,
  (select count(*) from agents)   as agentes,
  (select count(*) from runs)     as runs,
  (select count(*) from webhooks) as webhooks"

if row="$(docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -tA -F'|' -c "$QUERY" 2> /dev/null)"; then
  IFS='|' read -r USERS TASKS PROJECTS NOTES AGENTS RUNS WEBHOOKS <<< "$row"

  printf '  %-12s %s\n' "Usuarios" "$USERS"
  printf '  %-12s %s\n' "Tareas" "$TASKS"
  printf '  %-12s %s\n' "Proyectos" "$PROJECTS"
  printf '  %-12s %s\n' "Notas" "$NOTES"
  printf '  %-12s %s\n' "Agentes" "$AGENTS"
  printf '  %-12s %s\n' "Runs" "$RUNS"
  printf '  %-12s %s\n' "Webhooks" "$WEBHOOKS"

  if [ "$USERS" = "0" ]; then
    printf '\n  Todavía no hay usuario. Crea el primero en: %s/setup\n' "$APP_BASE_URL"
  fi
else
  info "no se puede consultar la base de datos (¿está arrancando?)"
fi

# ---------------------------------------------------------------------------
# Datos
# ---------------------------------------------------------------------------

step "Datos"
VOLUMES="$(docker volume ls --format '{{.Name}}' | grep '^agentdesk_' | tr '\n' ' ' || true)"
info "volúmenes: ${VOLUMES:-(ninguno)}"

BACKUPS="$(ls -1 ./backups/agentdesk-*.tar.gz 2> /dev/null | wc -l | tr -d ' ' || true)"
if [ "$BACKUPS" != "0" ]; then
  LAST="$(ls -t ./backups/agentdesk-*.tar.gz 2> /dev/null | head -1 || true)"
  info "copias de seguridad: $BACKUPS (la última: $LAST)"
else
  info "copias de seguridad: ninguna todavía → ./scripts/backup.sh"
fi

printf '\n  Logs:   docker compose logs -f app\n'
printf '  Parar:  ./scripts/stop.sh\n\n'
