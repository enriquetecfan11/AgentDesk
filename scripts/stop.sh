#!/usr/bin/env bash
#
# Para AgentDesk.
#
#   ./scripts/stop.sh           # para los contenedores y los deja ahí
#   ./scripts/stop.sh --down    # además los elimina (la imagen se queda)
#
# En los dos casos **no se pierde nada**: la base de datos y los artefactos
# viven en volúmenes con nombre (`pgdata` y `uploads`), no dentro de los
# contenedores. Parar o eliminar contenedores no toca los volúmenes.
#
# La diferencia entre los dos modos:
#
#   stop    arranca otra vez en un segundo, sin recrear nada.
#   --down  deja el `docker compose ps` limpio; al arrancar se recrean.
#
# Para volver a levantarlo:  ./scripts/start.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

MODE=stop
for arg in "$@"; do
  case "$arg" in
    --down) MODE=down ;;
    -h | --help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Opción desconocida: %s\n' "$arg" >&2; exit 1 ;;
  esac
done

info() { printf '  %s\n' "$1"; }
fail() { printf 'Error: %s\n' "$1" >&2; exit 1; }

command -v docker > /dev/null || fail "no encuentro docker en el PATH"

RUNNING="$(docker compose ps -q 2> /dev/null || true)"

if [ -z "$RUNNING" ]; then
  printf '\nAgentDesk no está arrancado: no hay contenedores que parar.\n'
  printf 'Si el `docker compose ps` te parece raro, pruébalo a mano.\n\n'
  exit 0
fi

if [ "$MODE" = "down" ]; then
  printf '\nParando y eliminando los contenedores…\n'
  docker compose down
else
  printf '\nParando los contenedores…\n'
  docker compose stop
fi

# Los volúmenes sobreviven a `stop` y a `down`: solo se borran con `down -v`.
REMAINING="$(docker compose ps -q 2> /dev/null || true)"
if [ -n "$REMAINING" ]; then
  fail "queda algún contenedor en marcha. Mira qué pasa con: docker compose ps"
fi

VOLUMES="$(docker volume ls --format '{{.Name}}' | grep -c '^agentdesk_' || true)"

printf '\nAgentDesk parado.\n\n'
info "volúmenes intactos: ${VOLUMES} (pgdata y uploads, con todos los datos)"
info "para volver a arrancarlo: ./scripts/start.sh"
printf '\n'
