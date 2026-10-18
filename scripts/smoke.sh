#!/usr/bin/env bash
#
# Prueba de humo de extremo a extremo contra una instalación en marcha.
#
#   ./scripts/smoke.sh
#
# Recorre el camino real que seguirá un agente o la UI: autenticación, alta de
# proyecto, etiqueta y tarea, subtareas, cambios de estado, validación de
# errores y limpieza final. No deja datos en la base de datos.
#
# Requiere: curl y python3 (presentes en macOS y en cualquier Debian/Ubuntu).
#
set -euo pipefail

cd "$(dirname "$0")/.."

BASE="${APP_BASE_URL:-}"
if [ -z "$BASE" ] && [ -f .env ]; then
  BASE="$(grep -E '^APP_BASE_URL=' .env | cut -d= -f2-)"
fi
if [ -z "$BASE" ]; then
  echo "No encuentro APP_BASE_URL (ni en el entorno ni en .env)" >&2
  exit 1
fi

EMAIL="${SMOKE_EMAIL:-smoke@agentdesk.local}"
PASSWORD="${SMOKE_PASSWORD:-smoke-password-2026}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# jget '<clave>.<subclave>'  → lee JSON de stdin
jget() {
  python3 -c "
import json, sys
node = json.load(sys.stdin)
for part in '$1'.split('.'):
    node = node[int(part)] if part.isdigit() else node[part]
print(node if node is not None else '')
"
}

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "→ Instalación: $BASE"

# ---------------------------------------------------------------------------
step "1. Autenticación"
# ---------------------------------------------------------------------------
available="$(curl -fsS "$BASE/api/auth/setup" | jget available)"

if [ "$available" = "True" ]; then
  response="$(curl -fsS -c "$JAR" -X POST "$BASE/api/auth/setup" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
  [ "$(printf '%s' "$response" | jget user.email)" = "$EMAIL" ] \
    && ok "primer usuario creado vía /api/auth/setup" \
    || bad "no se pudo crear el primer usuario"
else
  code="$(status -c "$JAR" -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"

  if [ "$code" != "200" ]; then
    echo "  No hay usuario de humo y no puedo crearlo (la instalación ya tiene usuarios)." >&2
    echo "  Ejecuta con SMOKE_EMAIL / SMOKE_PASSWORD de un usuario existente." >&2
    exit 1
  fi
  ok "login correcto con $EMAIL"
fi

# Credenciales incorrectas deben fallar.
code="$(status -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"definitivamente-incorrecta\"}")"
[ "$code" = "401" ] && ok "contraseña incorrecta → 401" || bad "contraseña incorrecta → $code (esperado 401)"

# ---------------------------------------------------------------------------
step "2. Proyecto y etiqueta"
# ---------------------------------------------------------------------------
PROJECT_ID="$(curl -fsS -b "$JAR" -X POST "$BASE/api/projects" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test","identifier":"smk","color":"#22c55e"}' | jget project.id)"
[ -n "$PROJECT_ID" ] && ok "proyecto creado (${PROJECT_ID:0:8})" || bad "no se pudo crear el proyecto"

LABEL_ID="$(curl -fsS -b "$JAR" -X POST "$BASE/api/labels" \
  -H 'Content-Type: application/json' \
  -d '{"name":"smoke","color":"#ef4444"}' | jget label.id)"
[ -n "$LABEL_ID" ] && ok "etiqueta creada (${LABEL_ID:0:8})" || bad "no se pudo crear la etiqueta"

# ---------------------------------------------------------------------------
step "3. Tareas"
# ---------------------------------------------------------------------------
TASK_ID="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Tarea de humo\",\"priority\":\"high\",\"projectId\":\"$PROJECT_ID\",\"dueDate\":\"2026-01-15\",\"dueTime\":\"09:30\",\"labelIds\":[\"$LABEL_ID\"]}" \
  | jget task.id)"
[ -n "$TASK_ID" ] && ok "tarea creada (${TASK_ID:0:8})" || bad "no se pudo crear la tarea"

task_json="$(curl -fsS -b "$JAR" "$BASE/api/tasks/$TASK_ID")"
[ "$(printf '%s' "$task_json" | jget task.priority)" = "high" ] \
  && ok "prioridad persistida" || bad "la prioridad no se guardó"
[ "$(printf '%s' "$task_json" | jget task.project.name)" = "Smoke Test" ] \
  && ok "proyecto resuelto en la respuesta" || bad "el proyecto no se resolvió"
[ "$(printf '%s' "$task_json" | jget task.labels.0.name)" = "smoke" ] \
  && ok "etiqueta resuelta en la respuesta" || bad "la etiqueta no se resolvió"

SUBTASK_ID="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Subtarea de humo\",\"parentTaskId\":\"$TASK_ID\"}" | jget task.id)"
[ -n "$SUBTASK_ID" ] && ok "subtarea creada" || bad "no se pudo crear la subtarea"

[ "$(curl -fsS -b "$JAR" "$BASE/api/tasks/$TASK_ID" | jget task.subtaskTotal)" = "1" ] \
  && ok "la tarea madre cuenta su subtarea" || bad "el contador de subtareas no cuadra"

# ---------------------------------------------------------------------------
step "4. Transiciones de estado"
# ---------------------------------------------------------------------------
curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' -d '{"status":"in_progress"}' > /dev/null

done_json="$(curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' -d '{"status":"done"}')"
[ "$(printf '%s' "$done_json" | jget task.status)" = "done" ] \
  && ok "estado actualizado a done" || bad "no se pudo completar la tarea"
[ -n "$(printf '%s' "$done_json" | jget task.completedAt)" ] \
  && ok "completedAt se rellena al completar" || bad "completedAt quedó vacío"

reopened="$(curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$TASK_ID" \
  -H 'Content-Type: application/json' -d '{"status":"todo"}')"
[ "$(printf '%s' "$reopened" | jget task.completedAt)" = "" ] \
  && ok "completedAt se limpia al reabrir" || bad "completedAt sobrevivió a la reapertura"

# ---------------------------------------------------------------------------
step "5. Validación y seguridad"
# ---------------------------------------------------------------------------
code="$(status -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"   "}')"
[ "$code" = "422" ] && ok "título vacío → 422" || bad "título vacío → $code (esperado 422)"

code="$(status -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' -d '{"title":"x"}')"
[ "$code" = "401" ] && ok "sin cookie → 401" || bad "sin cookie → $code (esperado 401)"

code="$(status -b "$JAR" "$BASE/api/tasks/no-es-un-uuid")"
[ "$code" = "404" ] && ok "id con formato inválido → 404" || bad "id inválido → $code (esperado 404)"

# ---------------------------------------------------------------------------
step "6. Limpieza"
# ---------------------------------------------------------------------------
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$SUBTASK_ID" > /dev/null && ok "subtarea eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$TASK_ID" > /dev/null && ok "tarea eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/projects/$PROJECT_ID" > /dev/null && ok "proyecto eliminado"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/labels/$LABEL_ID" > /dev/null && ok "etiqueta eliminada"

# ---------------------------------------------------------------------------
printf '\n\033[1mResultado:\033[0m %d correctas, %d fallidas\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
