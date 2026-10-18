#!/usr/bin/env bash
#
# Comprueba que la instalación responde. Lee APP_BASE_URL de .env, así que
# valida exactamente la URL que usan los navegadores de la LAN.
#
#   ./scripts/verify.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Falta .env. Copia .env.example y edítalo: cp .env.example .env" >&2
  exit 1
fi

APP_BASE_URL="$(grep -E '^APP_BASE_URL=' .env | cut -d= -f2-)"
echo "→ APP_BASE_URL = ${APP_BASE_URL}"
echo

echo "→ docker compose ps"
docker compose ps
echo

echo "→ GET ${APP_BASE_URL}/api/health"
health="$(curl -fsS --max-time 10 "${APP_BASE_URL}/api/health")"
echo "  ${health}"
echo

if ! printf '%s' "${health}" | grep -q '"status":"ok"'; then
  echo "✗ El healthcheck no devolvió status ok" >&2
  exit 1
fi

echo "→ GET ${APP_BASE_URL}/ (comprobando que renderiza)"
curl -fsS --max-time 10 "${APP_BASE_URL}/" | grep -q "AgentDesk"
echo "  ok"
echo

echo "✓ Instalación operativa en ${APP_BASE_URL}"
