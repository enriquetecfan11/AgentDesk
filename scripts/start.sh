#!/usr/bin/env bash
#
# Levanta AgentDesk entero: reconstruye la imagen, arranca los
# contenedores y espera a que el healthcheck diga "healthy".
#
#   ./scripts/start.sh              # reconstruye y arranca
#   ./scripts/start.sh --build      # alias conservado por compatibilidad
#   ./scripts/start.sh --no-wait    # no espera al healthcheck
#
# Es idempotente: si ya estaba arrancado, no le pasa nada.
#
# Para parar:  ./scripts/stop.sh
# Al terminar te dice la URL y, si es una instalación nueva, dónde crear el
# primer usuario.
#
set -euo pipefail

cd "$(dirname "$0")/.."

BUILD=1
WAIT=1
for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    --no-wait) WAIT=0 ;;
    -h | --help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Opción desconocida: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

info() { printf '  %s\n' "$1"; }
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }

command -v docker > /dev/null || fail "no encuentro docker en el PATH"
docker compose version > /dev/null 2>&1 || fail "no encuentro 'docker compose' (hace falta Compose v2)"

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    printf '\nHe creado .env a partir de .env.example.\n\n'
    printf 'Edítalo antes de arrancar. Como mínimo:\n'
    printf '  APP_BASE_URL      la URL tal como la escribe el navegador, SIN localhost\n'
    printf '  POSTGRES_PASSWORD una contraseña larga y sin caracteres raros\n\n'
    exit 1
  fi
  fail "no hay .env ni .env.example en $(pwd)"
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

APP_BASE_URL="${APP_BASE_URL:-}"
APP_PORT="${APP_PORT:-3000}"

[ -n "$APP_BASE_URL" ] || fail "APP_BASE_URL está vacía en .env"
case "$APP_BASE_URL" in
  http://* | https://*) ;;
  *) fail "APP_BASE_URL debe empezar por http:// o https:// (ahora: $APP_BASE_URL)" ;;
esac
case "$APP_BASE_URL" in
  *//localhost* | *//localhost:*)
    fail "APP_BASE_URL no puede llevar 'localhost': desde otro dispositivo apunta a ese dispositivo, no al servidor. Usa la IP de la LAN."
    ;;
esac
[ -n "${POSTGRES_PASSWORD:-}" ] || fail "POSTGRES_PASSWORD está vacía en .env"

# ---------------------------------------------------------------------------
# Imagen
# ---------------------------------------------------------------------------

if [ "$BUILD" = "1" ]; then
  printf '\nReconstruyendo la imagen…\n'
  docker compose build
fi

# ---------------------------------------------------------------------------
# Arranque
# ---------------------------------------------------------------------------

printf '\nArrancando…\n'
docker compose up -d

# ---------------------------------------------------------------------------
# Espera al healthcheck
# ---------------------------------------------------------------------------

healthy() {
  local id state
  id="$(docker compose ps -q "$1" 2> /dev/null || true)"
  [ -n "$id" ] || return 1
  state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2> /dev/null || true)"
  [ "$state" = "healthy" ]
}

if [ "$WAIT" = "1" ]; then
  printf '  esperando a que Postgres y la app estén sanos'
  ok=0
  for _ in $(seq 1 60); do
    if healthy db && healthy app; then ok=1; break; fi
    printf '.'
    sleep 3
  done
  printf '\n'

  if [ "$ok" != "1" ]; then
    printf '\nLos contenedores están arrancados, pero el healthcheck no ha llegado a "healthy" en 3 minutos.\n'
    printf 'Mira qué pasa:\n\n  docker compose logs --tail=50 app\n\n'
    exit 1
  fi
  info "Postgres y app: healthy"
fi

# ---------------------------------------------------------------------------
# Primer usuario
# ---------------------------------------------------------------------------

# Se consulta a Postgres directamente, sin depender de que la URL sea alcanzable
# desde esta máquina.
USERS="$(docker compose exec -T db \
  psql -U "${POSTGRES_USER:-agentdesk}" -d "${POSTGRES_DB:-agentdesk}" -tAc 'select count(*) from users' \
  2> /dev/null | tr -d '[:space:]' || true)"

printf '\nAgentDesk está en marcha.\n\n'
if [ "$USERS" = "0" ]; then
  printf '  Todavía no hay ningún usuario. Abre esto para crear el primero:\n\n    %s/setup\n\n' "$APP_BASE_URL"
else
  printf '  Ábrelo en:  %s\n' "$APP_BASE_URL"
  if [ -n "${APP_EXTRA_ORIGINS:-}" ]; then
    printf '  También por: %s\n' "$APP_EXTRA_ORIGINS"
  fi
  printf '  Desde otra máquina de la LAN o por Tailscale, la misma dirección.\n\n'
fi

printf '  Estado:  ./scripts/status.sh\n'
printf '  Logs:    docker compose logs -f app\n'
printf '  Parar:   ./scripts/stop.sh\n\n'
