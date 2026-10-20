#!/usr/bin/env bash
#
# Diagnóstico previo al despliegue.
#
#   ./scripts/doctor.sh
#
# Comprueba lo que suele romper un `docker compose up -d --build` en una
# máquina nueva: Docker y Compose, permisos, arquitectura, memoria, disco,
# DNS/salida a internet, .env, puerto y ficheros con finales de línea CRLF.
#
# No toca nada: solo lee. Sale con código 1 si hay algún bloqueante.
#
set -uo pipefail

cd "$(dirname "$0")/.."

FAIL=0
WARN=0

section() { printf '\n%s\n' "$1"; }
ok() { printf '  ✓ %s\n' "$1"; }
warn() {
  printf '  ! %s\n' "$1"
  WARN=$((WARN + 1))
}
bad() {
  printf '  ✗ %s\n' "$1"
  FAIL=$((FAIL + 1))
}

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------

section "Docker"

if ! command -v docker > /dev/null 2>&1; then
  bad "no encuentro 'docker' en el PATH"
  printf '\nNo se puede seguir sin Docker.\n'
  exit 1
fi
ok "docker $(docker version --format '{{.Client.Version}}' 2> /dev/null || echo '?')"

if docker info > /dev/null 2> /tmp/agentdesk-doctor-docker.err; then
  SERVER_OS="$(docker version --format '{{.Server.Os}}' 2> /dev/null || echo '?')"
  SERVER_ARCH="$(docker version --format '{{.Server.Arch}}' 2> /dev/null || echo '?')"
  if [ "$SERVER_OS" = "linux" ]; then
    ok "daemon accesible (${SERVER_OS}/${SERVER_ARCH})"
  else
    warn "el daemon no es Linux (${SERVER_OS}/${SERVER_ARCH}): la imagen es Linux y puede no arrancar"
  fi
else
  if grep -qi 'permission denied' /tmp/agentdesk-doctor-docker.err; then
    bad "sin permiso para hablar con el daemon. Añade tu usuario al grupo docker:"
    printf '      sudo usermod -aG docker "$USER"   # y vuelve a entrar por SSH\n'
  else
    bad "el daemon de Docker no responde: $(tail -1 /tmp/agentdesk-doctor-docker.err)"
    printf '      sudo systemctl status docker\n'
  fi
fi
rm -f /tmp/agentdesk-doctor-docker.err

if docker compose version > /dev/null 2>&1; then
  COMPOSE_VERSION="$(docker compose version --short 2> /dev/null || echo '?')"
  ok "Compose v${COMPOSE_VERSION#v}"
else
  bad "no existe 'docker compose' (hace falta el plugin Compose v2, no el docker-compose v1)"
  printf '      https://docs.docker.com/compose/install/linux/\n'
fi

if [ -f Dockerfile ] && [ -f docker-compose.yml ]; then
  ok "Dockerfile y docker-compose.yml presentes (el build es local, no hay registry)"
else
  bad "faltan Dockerfile o docker-compose.yml: este directorio no es el repo completo"
  printf '      El compose compila en local (build: .); no sirve copiar solo el YAML ni la imagen.\n'
fi

if docker compose config > /dev/null 2>&1; then
  ok "docker-compose.yml se interpreta correctamente"
else
  bad "docker-compose.yml no es válido para este Compose:"
  docker compose config 2>&1 | sed 's/^/      /' | head -5
fi

# ---------------------------------------------------------------------------
# Arquitectura de una imagen ya construida
# ---------------------------------------------------------------------------

if docker image inspect agentdesk:latest > /dev/null 2>&1; then
  IMAGE_ARCH="$(docker image inspect agentdesk:latest --format '{{.Architecture}}' 2> /dev/null || echo '?')"
  if [ "$IMAGE_ARCH" != "$SERVER_ARCH" ]; then
    bad "la imagen local agentdesk:latest es ${IMAGE_ARCH} y esta máquina es ${SERVER_ARCH}"
    printf '      Reconstruye aquí: docker compose build --no-cache\n'
  else
    ok "imagen local agentdesk:latest compatible (${IMAGE_ARCH})"
  fi
fi

# ---------------------------------------------------------------------------
# Recursos: el build de Next necesita aire
# ---------------------------------------------------------------------------

section "Recursos"

MEM_MB=""
if [ -r /proc/meminfo ]; then
  MEM_MB="$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)"
elif command -v sysctl > /dev/null 2>&1; then
  MEM_MB="$(( $(sysctl -n hw.memsize 2> /dev/null || echo 0) / 1024 / 1024 ))"
fi
if [ -n "$MEM_MB" ] && [ "$MEM_MB" -gt 0 ]; then
  if [ "$MEM_MB" -lt 1500 ]; then
    bad "solo ${MEM_MB} MB de RAM: next build puede morir por OOM (exit 137)"
    printf '      Sube la VM a 2 GB o añade swap antes de construir.\n'
  elif [ "$MEM_MB" -lt 2048 ]; then
    warn "${MEM_MB} MB de RAM: justo. Si el build muere con 'Killed', añade swap."
  else
    ok "${MEM_MB} MB de RAM"
  fi
fi

DISK_PATH="/var/lib/docker"
[ -d "$DISK_PATH" ] || DISK_PATH="/"
if command -v df > /dev/null 2>&1; then
  FREE_GB="$(df -Pk "$DISK_PATH" 2> /dev/null | awk 'NR == 2 { printf "%d", $4 / 1024 / 1024 }')"
  if [ -n "${FREE_GB:-}" ]; then
    if [ "$FREE_GB" -lt 4 ]; then
      bad "solo ${FREE_GB} GB libres en ${DISK_PATH}: el build necesita ~5 GB"
    elif [ "$FREE_GB" -lt 8 ]; then
      warn "${FREE_GB} GB libres en ${DISK_PATH}: suficiente para un build, poco para crecer"
    else
      ok "${FREE_GB} GB libres en ${DISK_PATH}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Red: Docker Hub y npm (el build descarga imagen base y paquetes)
# ---------------------------------------------------------------------------

section "Red"

if command -v getent > /dev/null 2>&1; then
  RESOLVE="getent hosts"
elif command -v dscacheutil > /dev/null 2>&1; then
  RESOLVE="dscacheutil -q host -a name"
else
  RESOLVE=""
fi

if [ -n "$RESOLVE" ]; then
  for host in registry.npmjs.org registry-1.docker.io; do
    if $RESOLVE "$host" > /dev/null 2>&1; then
      ok "DNS resuelve ${host}"
    else
      bad "no se resuelve ${host}: revisa /etc/resolv.conf y el DNS de la VM"
      printf '      Si el host resuelve pero Docker no, el build falla en npm ci con EAI_AGAIN.\n'
    fi
  done
else
  warn "no tengo herramienta para comprobar DNS; se omite"
fi

if command -v curl > /dev/null 2>&1; then
  if curl -fsS -m 10 -o /dev/null https://registry.npmjs.org/ 2> /dev/null; then
    ok "HTTPS contra registry.npmjs.org"
  else
    bad "no hay salida HTTPS a registry.npmjs.org (proxy, firewall o DNS)"
    printf '      El build falla en npm ci. Si usas proxy, configúralo en Docker.\n'
  fi
  HUB_CODE="$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://registry-1.docker.io/v2/ 2> /dev/null || echo 000)"
  case "$HUB_CODE" in
    200 | 401 | 403) ok "HTTPS contra Docker Hub (HTTP ${HUB_CODE})" ;;
    *)
      warn "no hay salida HTTPS a registry-1.docker.io (HTTP ${HUB_CODE}); el build necesita bajar node:22-bookworm-slim"
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# .env
# ---------------------------------------------------------------------------

section "Configuración"

if [ ! -f .env ]; then
  bad "no hay .env. Créalo antes de arrancar:"
  printf '      cp .env.example .env\n'
  printf '      # edita APP_BASE_URL y POSTGRES_PASSWORD\n'
else
  ok ".env presente"

  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a

  if [ -z "${APP_BASE_URL:-}" ]; then
    bad "APP_BASE_URL está vacía"
  elif ! printf '%s' "$APP_BASE_URL" | grep -Eq '^https?://'; then
    bad "APP_BASE_URL debe empezar por http:// o https:// (ahora: ${APP_BASE_URL})"
  elif printf '%s' "$APP_BASE_URL" | grep -Eq '//localhost([:/]|$)'; then
    bad "APP_BASE_URL usa localhost: desde otro dispositivo apunta al dispositivo, no al servidor"
  else
    ok "APP_BASE_URL=${APP_BASE_URL}"
  fi

  if [ -z "${POSTGRES_PASSWORD:-}" ]; then
    bad "POSTGRES_PASSWORD está vacía: Postgres no arranca sin ella"
  elif printf '%s' "$POSTGRES_PASSWORD" | grep -Eq '[@:/?#$" ]'; then
    bad "POSTGRES_PASSWORD lleva caracteres que rompen DATABASE_URL (@ : / ? # \$ espacio o comillas)"
  else
    ok "POSTGRES_PASSWORD definida"
  fi

  if [ -z "${POSTGRES_USER:-}" ] || [ -z "${POSTGRES_DB:-}" ]; then
    bad "POSTGRES_USER o POSTGRES_DB vacías"
  else
    ok "Postgres: usuario=${POSTGRES_USER} base=${POSTGRES_DB}"
  fi

  case "${DATABASE_URL:-}" in
    *'@db:'*) ok "DATABASE_URL apunta al servicio 'db'" ;;
    '') bad "DATABASE_URL está vacía" ;;
    *) warn "DATABASE_URL no apunta a '@db:'; dentro de Docker el host debe ser 'db'" ;;
  esac
fi

# ---------------------------------------------------------------------------
# Puerto
# ---------------------------------------------------------------------------

section "Puerto"

PORT="${APP_PORT:-3000}"
if command -v docker > /dev/null 2>&1 && docker ps --format '{{.Names}} {{.Ports}}' 2> /dev/null | grep -q ":${PORT}->"; then
  ok "el puerto ${PORT} ya lo publica un contenedor (el stack parece estar arriba)"
elif command -v ss > /dev/null 2>&1; then
  if ss -H -ltn 2> /dev/null | awk '{ print $4 }' | grep -Eq ":${PORT}$"; then
    bad "el puerto ${PORT} está ocupado por otro proceso. Cambia APP_PORT en .env"
  else
    ok "puerto ${PORT} libre"
  fi
elif command -v lsof > /dev/null 2>&1; then
  if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN > /dev/null 2>&1; then
    bad "el puerto ${PORT} está ocupado por otro proceso. Cambia APP_PORT en .env"
  else
    ok "puerto ${PORT} libre"
  fi
fi

# ---------------------------------------------------------------------------
# Finales de línea (copiar el repo desde Windows rompe el entrypoint)
# ---------------------------------------------------------------------------

section "Ficheros"

CRLF=""
for f in docker/entrypoint.sh scripts/*.sh; do
  if [ -f "$f" ] && grep -q $'\r' "$f" 2> /dev/null; then
    CRLF="${CRLF}${f}"$'\n'
  fi
done
if [ -n "$CRLF" ]; then
  bad "hay scripts con finales de línea CRLF (Windows); el contenedor no los podrá ejecutar:"
  printf '%s\n' "$CRLF" | sed 's/^/      /'
  printf '      Arréglalo con: git config core.autocrlf false && git checkout -- .\n'
else
  ok "scripts en LF"
fi

# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------

printf '\n'
if [ "$FAIL" -gt 0 ]; then
  printf 'Hay %d bloqueante(s)' "$FAIL"
  [ "$WARN" -gt 0 ] && printf ' y %d aviso(s)' "$WARN"
  printf '.\nCorrige lo marcado con ✗ y vuelve a ejecutar este script.\n'
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  printf 'Sin bloqueantes, con %d aviso(s). Puedes construir:\n\n' "$WARN"
else
  printf 'Todo en orden. Puedes construir:\n\n'
fi
printf '  docker compose up -d --build\n\n'
