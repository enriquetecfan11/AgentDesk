#!/usr/bin/env bash
#
# Reinicia AgentDesk recreando los contenedores.
#
#   ./scripts/restart.sh             # recrea app y base de datos
#   ./scripts/restart.sh app         # recrea solo la app (lo normal)
#   ./scripts/restart.sh --build     # y además reconstruye la imagen
#
# Es el comando para después de tocar `.env`: `docker compose restart` solo
# reinicia el proceso, y un contenedor no cambia sus variables de entorno
# hasta que se recrea. Esto sí las relee.
#
# Equivale a:  ./scripts/stop.sh && ./scripts/start.sh [--build]
#
set -euo pipefail

cd "$(dirname "$0")/.."

SERVICE=""
BUILD_FLAG=""
for arg in "$@"; do
  case "$arg" in
    app | db) SERVICE="$arg" ;;
    --build) BUILD_FLAG="--build" ;;
    -h | --help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Opción desconocida: %s (se espera "app", "db" o --build)\n' "$arg" >&2; exit 1 ;;
  esac
done

info() { printf '  %s\n' "$1"; }
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }

command -v docker > /dev/null || fail "no encuentro docker en el PATH"

if [ -n "$BUILD_FLAG" ]; then
  printf '\nConstruyendo la imagen…\n'
  docker compose build
fi

# La app depende de que la base esté sana, así que recrear solo la app es
# suficiente para el caso normal (cambiar APP_BASE_URL, por ejemplo).
if [ -n "$SERVICE" ]; then
  printf '\nRecreando el contenedor "%s"…\n' "$SERVICE"
else
  printf '\nRecreando los contenedores…\n'
fi

docker compose up -d --force-recreate $SERVICE

# Mismo criterio que start.sh: no se da por bueno hasta que el healthcheck dice
# "healthy", que es lo que confirma que las migraciones y el servidor están bien.
healthy() {
  local id state
  id="$(docker compose ps -q "$1" 2> /dev/null || true)"
  [ -n "$id" ] || return 1
  state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2> /dev/null || true)"
  [ "$state" = "healthy" ]
}

printf '  esperando al healthcheck'
ok=0
for _ in $(seq 1 40); do
  if healthy app && healthy db; then ok=1; break; fi
  printf '.'
  sleep 3
done
printf '\n'

if [ "$ok" = "1" ]; then
  info "Postgres y app: healthy"
  printf '\nListo.\n\n'
  printf '  Estado: ./scripts/status.sh\n\n'
else
  printf '\nHa vuelto a arrancar, pero el healthcheck no llega a "healthy".\n'
  printf 'Casi siempre es una variable mal en .env. Mira los logs:\n\n  docker compose logs --tail=50 app\n\n'
  exit 1
fi
