#!/usr/bin/env bash
#
# Cambia la contraseña de un usuario. No hay SMTP: esta es la vía de recuperación.
#
#   ./scripts/reset-password.sh correo@example.com 'contraseña-nueva'
#
# No necesita Node en el host: el script vive empaquetado dentro del contenedor.
# Además cierra todas las sesiones abiertas de ese usuario.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <email> <contraseña-nueva>" >&2
  exit 1
fi

if ! docker compose ps --status running --services 2>/dev/null | grep -qx app; then
  echo "El contenedor de la app no está en marcha. Arranca con: docker compose up -d" >&2
  exit 1
fi

docker compose exec -T app node reset-password.mjs "$1" "$2"
