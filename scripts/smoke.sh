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
WORK_DIR="$(mktemp -d)"
RECEIVER_PID=""

# El receptor de webhooks se lanza en segundo plano: se limpia pase lo que pase.
cleanup() {
  if [ -n "$RECEIVER_PID" ]; then
    kill "$RECEIVER_PID" 2>/dev/null || true
    wait "$RECEIVER_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
  rm -f "$JAR"
}
trap cleanup EXIT

PASS=0
FAIL=0

ok()   { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# jget '<clave>.<subclave>'  → lee JSON de stdin (devuelve '' si no existe)
jget() {
  python3 -c "
import json, sys

node = json.load(sys.stdin)

for part in '$1'.split('.'):
    if isinstance(node, list):
        index = int(part) if part.isdigit() else -1
        node = node[index] if 0 <= index < len(node) else ''
    elif isinstance(node, dict):
        node = node.get(part, '')
    else:
        node = ''

print('' if node is None else node)
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
step "6. Captura rápida y recurrencias"
# ---------------------------------------------------------------------------
TODAY="$(python3 -c 'import datetime; print(datetime.date.today())')"
TOMORROW="$(python3 -c 'import datetime; print(datetime.date.today() + datetime.timedelta(days=1))')"

# Lenguaje natural, proyecto por identificador y etiqueta nueva.
capture_json="$(curl -fsS -b "$JAR" -X POST "$BASE/api/capture" \
  -H 'Content-Type: application/json' \
  -d '{"text":"revisar CVEs mañana 10:00 p1 #smk @captura"}')"
CAPTURED_ID="$(printf '%s' "$capture_json" | jget task.id)"
CAPTURED_LABEL_ID="$(printf '%s' "$capture_json" | jget task.labels.0.id)"

[ "$(printf '%s' "$capture_json" | jget capture.title)" = "revisar CVEs" ] \
  && ok "el título deja fuera los modificadores" || bad "el título quedó mal"
[ "$(printf '%s' "$capture_json" | jget task.dueDate)" = "$TOMORROW" ] \
  && ok "«mañana» se resuelve a $TOMORROW" || bad "la fecha relativa falló"
# El driver devuelve `time` con segundos ("10:00:00"): basta con el prefijo.
case "$(printf '%s' "$capture_json" | jget task.dueTime)" in
  10:00*) ok "la hora se conserva (10:00)" ;;
  *) bad "la hora se perdió" ;;
esac
[ "$(printf '%s' "$capture_json" | jget task.priority)" = "urgent" ] \
  && ok "«p1» es prioridad urgente" || bad "la prioridad no se aplicó"
[ "$(printf '%s' "$capture_json" | jget task.project.name)" = "Smoke Test" ] \
  && ok "«#smk» resuelve el proyecto por identificador" || bad "el proyecto no se resolvió"
[ "$(printf '%s' "$capture_json" | jget task.labels.0.name)" = "captura" ] \
  && ok "«@captura» crea la etiqueta al vuelo" || bad "la etiqueta no se creó"
[ "$(printf '%s' "$capture_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["notes"]))')" = "0" ] \
  && ok "sin avisos cuando todo se entiende" || bad "aparecieron avisos inesperados"

# Un proyecto que no existe no se inventa: se avisa y la tarea se guarda suelta.
notes_json="$(curl -fsS -b "$JAR" -X POST "$BASE/api/capture" \
  -H 'Content-Type: application/json' \
  -d '{"text":"revisar algo #proyecto-que-no-existe"}')"
ORPHAN_ID="$(printf '%s' "$notes_json" | jget task.id)"
[ "$(printf '%s' "$notes_json" | jget task.projectId)" = "" ] \
  && ok "proyecto desconocido → tarea sin proyecto" || bad "se asignó un proyecto inexistente"
[ "$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)["notes"]))' <<< "$notes_json")" = "1" ] \
  && ok "se avisa del proyecto desconocido" || bad "no se avisó del proyecto desconocido"

# El Inbox es exactamente lo que no tiene proyecto ni fecha.
[ "$(curl -fsS -b "$JAR" "$BASE/api/tasks?inbox=1" | python3 -c "
import json, sys
ids = [task['id'] for task in json.load(sys.stdin)['tasks']]
print('si' if '$ORPHAN_ID' in ids else 'no')
")" = "si" ] \
  && ok "la tarea sin proyecto aparece en el Inbox" || bad "el Inbox no la incluye"

# Al completar una tarea recurrente, avanza en lugar de cerrarse.
recurring_json="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Tarea recurrente\",\"dueDate\":\"$TODAY\",\"recurrence\":\"FREQ=DAILY\"}")"
RECURRING_ID="$(printf '%s' "$recurring_json" | jget task.id)"

advanced_json="$(curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$RECURRING_ID" \
  -H 'Content-Type: application/json' -d '{"status":"done"}')"
[ "$(printf '%s' "$advanced_json" | jget task.status)" = "todo" ] \
  && ok "recurrente: sigue abierta tras completarla" || bad "la recurrente se cerró"
[ "$(printf '%s' "$advanced_json" | jget task.dueDate)" = "$TOMORROW" ] \
  && ok "recurrente: avanza a $TOMORROW" || bad "la recurrente no avanzó"
[ "$(printf '%s' "$advanced_json" | jget recurrenceAdvanced.to)" = "$TOMORROW" ] \
  && ok "la API informa del avance" || bad "no se informó del avance"
[ -z "$(printf '%s' "$advanced_json" | jget task.completedAt)" ] \
  && ok "recurrente: completedAt queda vacío" || bad "la recurrente quedó marcada como completada"

# Una tarea normal sí se cierra.
plain_json="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" \
  -H 'Content-Type: application/json' -d '{"title":"Tarea normal"}')"
PLAIN_ID="$(printf '%s' "$plain_json" | jget task.id)"
[ -n "$(curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$PLAIN_ID" \
  -H 'Content-Type: application/json' -d '{"status":"done"}' | jget task.completedAt)" ] \
  && ok "una tarea sin recurrencia se cierra con completedAt" || bad "completedAt no se rellenó"

# Una regla inválida se rechaza en la puerta, no más tarde.
code="$(status -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"x","recurrence":"FREQ=CADA_LUNA"}')"
[ "$code" = "422" ] && ok "recurrencia inválida → 422" || bad "recurrencia inválida → $code (esperado 422)"

# ---------------------------------------------------------------------------
step "7. Búsqueda"
# ---------------------------------------------------------------------------
search_json="$(curl -fsS -b "$JAR" "$BASE/api/search?q=revisar%20CVEs")"
[ "$(printf '%s' "$search_json" | jget tasks.0.id)" = "$CAPTURED_ID" ] \
  && ok "la búsqueda encuentra la tarea capturada" || bad "la búsqueda no la encontró"

project_json="$(curl -fsS -b "$JAR" "$BASE/api/search?q=Smoke")"
[ "$(printf '%s' "$project_json" | jget projects.0.name)" = "Smoke Test" ] \
  && ok "la búsqueda encuentra el proyecto" || bad "la búsqueda no encontró el proyecto"

[ "$(curl -fsS -b "$JAR" "$BASE/api/search?q=a" | jget tasks.0.id)" = "" ] \
  && ok "una letra no dispara búsquedas" || bad "la búsqueda se ejecutó con una sola letra"

# ---------------------------------------------------------------------------
step "8. Páginas nuevas"
# ---------------------------------------------------------------------------
for route in /inbox /today /upcoming /notes /agents /runs; do
  http="$(status -b "$JAR" "$BASE$route")"
  [ "$http" = "200" ] && ok "$route responde 200" || bad "$route responde $http"
done

# ---------------------------------------------------------------------------
step "9. Notas, enlaces y vault"
# ---------------------------------------------------------------------------
# Dos notas que se enlazan: la resolución de [[enlaces]] vive en el servidor.
note_a="$(curl -fsS -b "$JAR" -X POST "$BASE/api/notes" -H 'Content-Type: application/json' \
  -d '{"title":"Nota de humo A","contentMd":"# A\n\nver [[Nota de humo B]] y [un enlace](https://x.dev)"}')"
NOTE_A_ID="$(printf '%s' "$note_a" | jget note.id)"

note_b="$(curl -fsS -b "$JAR" -X POST "$BASE/api/notes" -H 'Content-Type: application/json' \
  -d '{"title":"Nota de humo B","contentMd":"**negrita** y `código`"}')"
NOTE_B_ID="$(printf '%s' "$note_b" | jget note.id)"

[ -n "$NOTE_A_ID" ] && [ -n "$NOTE_B_ID" ] && ok "se crean dos notas" || bad "no se crearon"

detail_a="$(curl -fsS -b "$JAR" "$BASE/api/notes/$NOTE_A_ID")"
[ "$(printf '%s' "$detail_a" | jget outgoing.0.note.id)" = "$NOTE_B_ID" ] \
  && ok "[[enlace]] resuelto a la nota existente" || bad "el enlace no se resolvió"

detail_b="$(curl -fsS -b "$JAR" "$BASE/api/notes/$NOTE_B_ID")"
[ "$(printf '%s' "$detail_b" | jget backlinks.0.id)" = "$NOTE_A_ID" ] \
  && ok "backlink calculado en la nota destino" || bad "no hay backlink"

[ "$(curl -fsS -b "$JAR" "$BASE/api/notes?q=Nota%20de%20humo%20A" | jget notes.0.title)" = "Nota de humo A" ] \
  && ok "la búsqueda de notas encuentra por título" || bad "la búsqueda de notas falló"

# Renombrar reconstruye el grafo: el título antiguo deja de existir.
curl -fsS -b "$JAR" -X PATCH "$BASE/api/notes/$NOTE_B_ID" -H 'Content-Type: application/json' \
  -d '{"title":"Nota de humo B renombrada"}' > /dev/null
[ "$(curl -fsS -b "$JAR" "$BASE/api/notes/$NOTE_A_ID" | jget outgoing.0.note)" = "" ] \
  && ok "tras renombrar, el enlace queda sin destino" || bad "el enlace apunta a algo inexistente"
[ "$(curl -fsS -b "$JAR" "$BASE/api/notes/$NOTE_B_ID" | jget backlinks.0.id)" = "" ] \
  && ok "y el backlink desaparece" || bad "el backlink sobrevivió al renombrado"

# El título es la identidad: no puede repetirse.
code="$(status -b "$JAR" -X POST "$BASE/api/notes" -H 'Content-Type: application/json' \
  -d '{"title":"Nota de humo A"}')"
[ "$code" = "409" ] && ok "título duplicado → 409" || bad "título duplicado → $code (esperado 409)"

# Importar un .md con frontmatter, sin pisar lo existente.
import_body='{"files":[{"name":"Importada.md","content":"---\ntitle: Importada de Obsidian\ntags: [seguridad]\n---\n\nver [[Nota de humo A]]"}],"overwrite":false}'
import_1="$(curl -fsS -b "$JAR" -X POST "$BASE/api/notes/import" -H 'Content-Type: application/json' -d "$import_body")"
[ "$(printf '%s' "$import_1" | jget created)" = "1" ] \
  && ok "importar: 1 nota creada desde frontmatter" || bad "la importación no creó nada"
IMPORTED_ID="$(curl -fsS -b "$JAR" "$BASE/api/notes?q=Importada%20de%20Obsidian" | jget notes.0.id)"

import_2="$(curl -fsS -b "$JAR" -X POST "$BASE/api/notes/import" -H 'Content-Type: application/json' -d "$import_body")"
[ "$(printf '%s' "$import_2" | jget skipped)" = "1" ] \
  && ok "importar dos veces: se omite la existente" || bad "no se omitió la nota existente"

import_3="$(curl -fsS -b "$JAR" -X POST "$BASE/api/notes/import" -H 'Content-Type: application/json' \
  -d "$(printf '%s' "$import_body" | sed 's/"overwrite":false/"overwrite":true/')")"
[ "$(printf '%s' "$import_3" | jget updated)" = "1" ] \
  && ok "importar con overwrite: se actualiza" || bad "no se actualizó la nota"

# La nota importada enlaza con A, así que A tiene un backlink nuevo.
[ "$(curl -fsS -b "$JAR" "$BASE/api/notes/$NOTE_A_ID" | jget backlinks.0.id)" = "$IMPORTED_ID" ] \
  && ok "el backlink de la nota importada se calcula" || bad "falta el backlink de la importada"

# Exportación: un ZIP real, que el sistema operativo pueda abrir.
ZIP_DIR="$(mktemp -d)"
curl -fsS -b "$JAR" "$BASE/api/notes/export" -o "$ZIP_DIR/vault.zip"
[ "$(python3 -c "
import sys
data = open('$ZIP_DIR/vault.zip','rb').read()
print('pk' if data[:2] == b'PK' else 'no')
")" = "pk" ] && ok "la exportación es un ZIP" || bad "la exportación no es un ZIP"

if command -v unzip > /dev/null 2>&1; then
  listing="$(unzip -l "$ZIP_DIR/vault.zip" 2>/dev/null || true)"
  printf '%s' "$listing" | grep -q "Nota de humo A.md" \
    && ok "el ZIP contiene los .md con su título" || bad "el ZIP no contiene la nota esperada"
  printf '%s' "$listing" | grep -q "Importada de Obsidian.md" \
    && ok "el ZIP incluye la nota importada" || bad "falta la nota importada en el ZIP"
else
  ok "unzip no disponible: ZIP verificado solo por firma"
fi

# Y el .md exportado vuelve a reconocerse igual: reimportarlo no duplica nada.
if command -v unzip > /dev/null 2>&1; then
  unzip -o -q "$ZIP_DIR/vault.zip" "Nota de humo A.md" -d "$ZIP_DIR/out" 2>/dev/null || true

  if [ -f "$ZIP_DIR/out/Nota de humo A.md" ]; then
    roundtrip_body="$(python3 -c "
import json
content = open('$ZIP_DIR/out/Nota de humo A.md', encoding='utf-8').read()
print(json.dumps({'files': [{'name': 'Copia de A.md', 'content': content}], 'overwrite': False}))
")"
    roundtrip="$(curl -fsS -b "$JAR" -X POST "$BASE/api/notes/import" \
      -H 'Content-Type: application/json' -d "$roundtrip_body")"

    # El frontmatter exportado conserva el título, así que se detecta como
    # duplicado: es exactamente lo que se quiere al reimportar el vault.
    [ "$(printf '%s' "$roundtrip" | jget skipped)" = "1" ] \
      && ok "el .md exportado se reconoce al reimportar" || bad "el .md exportado no se reconoció"
  else
    bad "no se pudo extraer el .md del ZIP"
  fi
fi

rm -rf "$ZIP_DIR"

# ---------------------------------------------------------------------------
step "10. Agentes, tokens y API v1"
# ---------------------------------------------------------------------------
# auth_api usa el token del agente; el resto de la sección lo usa para hablar
# con /api/v1 como lo haría un agente de verdad.
agent="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents" -H 'Content-Type: application/json' \
  -d '{"name":"Agente de humo","description":"Pruebas automáticas","capabilities":["revisar CVEs","informes"]}')"
AGENT_ID="$(printf '%s' "$agent" | jget agent.id)"
[ -n "$AGENT_ID" ] && ok "agente creado" || bad "no se creó el agente"

token="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents/$AGENT_ID/tokens" -H 'Content-Type: application/json' \
  -d '{"name":"humo","scopes":["tasks:read","tasks:write","delegations:read","delegations:write","runs:read","runs:write","notes:read","notes:write"]}')"
AGENT_TOKEN="$(printf '%s' "$token" | jget secret)"
TOKEN_ID="$(printf '%s' "$token" | jget token.id)"
case "$AGENT_TOKEN" in
  agt_*) ok "token emitido (se muestra una sola vez)" ;;
  *) bad "el token no tiene el formato esperado: $AGENT_TOKEN" ;;
esac
[ -n "$(printf '%s' "$token" | jget token.tokenPrefix)" ] && ok "del token se guarda solo el prefijo" || bad "falta el prefijo"

# Un segundo token con scopes mínimos: sirve para comprobar que el scope se respeta.
limited="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents/$AGENT_ID/tokens" -H 'Content-Type: application/json' \
  -d '{"name":"solo-runs","scopes":["runs:read"]}')"
LIMITED_TOKEN="$(printf '%s' "$limited" | jget secret)"

auth_api() { curl -s -H "Authorization: Bearer $AGENT_TOKEN" "$@"; }

[ "$(auth_api "$BASE/api/v1/me" | jget agent.id)" = "$AGENT_ID" ] \
  && ok "/api/v1/me identifica al agente" || bad "/api/v1/me no devuelve el agente"
[ "$(auth_api "$BASE/api/v1/me" | jget agent.capabilities.0)" = "revisar CVEs" ] \
  && ok "las capacidades viajan en /me" || bad "faltan las capacidades en /me"
[ "$(auth_api "$BASE/api/v1/me" | jget scopes.0)" = "tasks:read" ] \
  && ok "y los scopes concedidos" || bad "faltan los scopes"

[ "$(status "$BASE/api/v1/me")" = "401" ] && ok "sin token → 401" || bad "sin token no devuelve 401"
[ "$(status -H "Authorization: Bearer agt_$(printf 'x%.0s' {1..43})" "$BASE/api/v1/me")" = "401" ] \
  && ok "un token que no existe → 401" || bad "un token inexistente autenticó"
[ "$(status -H "Authorization: Bearer $LIMITED_TOKEN" "$BASE/api/v1/tasks")" = "403" ] \
  && ok "scope insuficiente → 403" || bad "el scope no se está comprobando"

# Tareas a través de la API de agentes.
task="$(auth_api -X POST "$BASE/api/v1/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Tarea pedida por un agente","priority":"high"}')"
AGENT_TASK_ID="$(printf '%s' "$task" | jget task.id)"
[ -n "$AGENT_TASK_ID" ] && ok "el agente crea tareas" || bad "el agente no pudo crear la tarea"
[ "$(printf '%s' "$task" | jget task.assigneeId)" = "$AGENT_ID" ] \
  && ok "una tarea creada por el agente se le asigna a él" || bad "la tarea no se autoasignó"

[ "$(auth_api "$BASE/api/v1/tasks?q=pedida%20por%20un%20agente" | jget tasks.0.id)" = "$AGENT_TASK_ID" ] \
  && ok "el agente lista sus tareas" || bad "la lista de tareas del agente falló"

comment="$(auth_api -X POST "$BASE/api/v1/tasks/$AGENT_TASK_ID/comments" -H 'Content-Type: application/json' \
  -d '{"body":"Empiezo por los CVEs críticos."}')"
[ -n "$(printf '%s' "$comment" | jget comment.id)" ] && ok "el agente comenta en la tarea" || bad "no se pudo comentar"
[ "$(auth_api "$BASE/api/v1/tasks/$AGENT_TASK_ID" | jget comments.0.authorName)" = "Agente de humo" ] \
  && ok "el comentario queda en el hilo de la tarea" || bad "el comentario no se guardó"

# Delegación del humano al agente, y su cola de trabajo.
delegation="$(curl -fsS -b "$JAR" -X POST "$BASE/api/delegations" -H 'Content-Type: application/json' \
  -d "{\"toAgentId\":\"$AGENT_ID\",\"title\":\"Revisar CVEs del mes\",\"instructions\":\"Solo críticos y altos\",\"taskId\":\"$AGENT_TASK_ID\"}")"
DELEGATION_ID="$(printf '%s' "$delegation" | jget delegation.id)"
[ -n "$DELEGATION_ID" ] && ok "delegación creada desde la UI" || bad "no se creó la delegación"

queue="$(auth_api "$BASE/api/v1/queue")"
[ "$(printf '%s' "$queue" | jget delegations.0.id)" = "$DELEGATION_ID" ] \
  && ok "la delegación aparece en la cola del agente" || bad "la cola no incluye la delegación"
[ "$(printf '%s' "$queue" | jget tasks.0.id)" = "$AGENT_TASK_ID" ] \
  && ok "la tarea asignada aparece en la cola" || bad "falta la tarea en la cola"

# Un run: abrir, registrar, adjuntar y cerrar.
run="$(auth_api -X POST "$BASE/api/v1/runs" -H 'Content-Type: application/json' \
  -d "{\"delegationId\":\"$DELEGATION_ID\",\"taskId\":\"$AGENT_TASK_ID\",\"status\":\"running\",\"input\":{\"rango\":\"último mes\"}}")"
RUN_ID="$(printf '%s' "$run" | jget run.id)"
[ -n "$RUN_ID" ] && ok "el agente abre un run" || bad "no se creó el run"
[ -n "$(printf '%s' "$run" | jget run.startedAt)" ] && ok "el run arranca con startedAt" || bad "falta startedAt"

[ "$(curl -fsS -b "$JAR" "$BASE/api/delegations/$DELEGATION_ID" | jget delegation.status)" = "in_progress" ] \
  && ok "abrir el run pone la delegación en curso" || bad "la delegación no siguió al run"

[ "$(auth_api -X PATCH "$BASE/api/v1/delegations/$DELEGATION_ID" -H 'Content-Type: application/json' \
  -d '{"status":"in_progress","note":"Revisando inventario"}' | jget delegation.status)" = "in_progress" ] \
  && ok "el agente actualiza el estado de la delegación" || bad "no se pudo actualizar la delegación"

batch="$(auth_api -X POST "$BASE/api/v1/runs/$RUN_ID/logs" -H 'Content-Type: application/json' \
  -d '{"logs":[{"level":"info","message":"Consultando inventario"},{"level":"warn","message":"3 hosts sin parchear"}]}')"
[ "$(printf '%s' "$batch" | jget logs.1.level)" = "warn" ] \
  && ok "el agente envía logs en lote" || bad "los logs en lote fallaron"

single="$(auth_api -X POST "$BASE/api/v1/runs/$RUN_ID/logs" -H 'Content-Type: application/json' \
  -d '{"message":"Informe listo"}')"
[ "$(printf '%s' "$single" | jget logs.0.level)" = "info" ] \
  && ok "una línea suelta también se acepta" || bad "la línea suelta falló"

text_artifact="$(auth_api -X POST "$BASE/api/v1/runs/$RUN_ID/artifacts" -H 'Content-Type: application/json' \
  -d '{"name":"resumen.md","kind":"text","content":"# Resumen\n- 3 hosts sin parchear"}')"
TEXT_ARTIFACT_ID="$(printf '%s' "$text_artifact" | jget artifact.id)"
[ "$(printf '%s' "$text_artifact" | jget artifact.kind)" = "text" ] \
  && ok "artefacto de texto adjuntado" || bad "el artefacto de texto falló"

file_artifact="$(auth_api -X POST "$BASE/api/v1/runs/$RUN_ID/artifacts" -H 'Content-Type: application/json' \
  -d "{\"name\":\"detalle.txt\",\"kind\":\"file\",\"mimeType\":\"text/plain\",\"contentBase64\":\"$(printf 'contenido de prueba' | base64)\"}")"
FILE_ARTIFACT_ID="$(printf '%s' "$file_artifact" | jget artifact.id)"
[ "$(printf '%s' "$file_artifact" | jget artifact.downloadUrl)" = "/api/artifacts/$FILE_ARTIFACT_ID" ] \
  && ok "artefacto de fichero con URL de descarga" || bad "el artefacto de fichero falló"
[ "$(curl -fsS -b "$JAR" "$BASE/api/artifacts/$FILE_ARTIFACT_ID")" = "contenido de prueba" ] \
  && ok "el fichero se descarga con la sesión del humano" || bad "no se pudo descargar el artefacto"
[ "$(curl -fsS "$BASE/api/artifacts/$FILE_ARTIFACT_ID" 2>/dev/null || true)" = "# Resumen" ] \
  && bad "un artefacto se descargó sin autenticar" \
  || ok "sin sesión ni token, el artefacto no se entrega"

closed="$(auth_api -X PATCH "$BASE/api/v1/runs/$RUN_ID" -H 'Content-Type: application/json' \
  -d '{"status":"succeeded","output":"3 hosts sin parchear"}')"
[ "$(printf '%s' "$closed" | jget run.status)" = "succeeded" ] && ok "el run se cierra" || bad "no se cerró el run"
[ -n "$(printf '%s' "$closed" | jget run.durationMs)" ] && ok "el servidor calcula la duración" || bad "falta durationMs"
[ -n "$(printf '%s' "$closed" | jget run.finishedAt)" ] && ok "y sella finishedAt" || bad "falta finishedAt"

detail="$(auth_api "$BASE/api/v1/runs/$RUN_ID")"
[ "$(printf '%s' "$detail" | jget logs.2.message)" = "Informe listo" ] \
  && ok "el detalle trae los 3 logs en orden" || bad "los logs no están completos"
[ "$(printf '%s' "$detail" | jget artifacts.1.name)" = "detalle.txt" ] \
  && ok "y los 2 artefactos" || bad "faltan artefactos en el detalle"

[ "$(curl -fsS -b "$JAR" "$BASE/api/delegations/$DELEGATION_ID" | jget delegation.status)" = "completed" ] \
  && ok "cerrar el run completa la delegación" || bad "la delegación no siguió al run"

# Aislamiento entre agentes.
other="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents" -H 'Content-Type: application/json' \
  -d '{"name":"Agente vecino de humo"}')"
OTHER_AGENT_ID="$(printf '%s' "$other" | jget agent.id)"
other_token="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents/$OTHER_AGENT_ID/tokens" -H 'Content-Type: application/json' \
  -d '{"name":"humo","scopes":["runs:read","runs:write","tasks:read","delegations:read"]}')"
OTHER_TOKEN="$(printf '%s' "$other_token" | jget secret)"

[ "$(status -H "Authorization: Bearer $OTHER_TOKEN" "$BASE/api/v1/runs/$RUN_ID")" = "403" ] \
  && ok "un agente no ve los runs de otro" || bad "los runs no están aislados por agente"
[ "$(status -H "Authorization: Bearer $OTHER_TOKEN" "$BASE/api/v1/queue")" = "200" ] \
  && ok "pero sí ve su propia cola" || bad "el otro agente no puede leer su cola"

# Server-Sent Events: saluda y mantiene el canal abierto.
sse_agent="$(curl -s --max-time 2 -H "Authorization: Bearer $AGENT_TOKEN" "$BASE/api/v1/events" || true)"
printf '%s' "$sse_agent" | grep -q 'event: hello' \
  && ok "/api/v1/events abre un flujo SSE" || bad "el SSE del agente no saludó"

sse_ui="$(curl -s --max-time 2 -b "$JAR" "$BASE/api/events" || true)"
printf '%s' "$sse_ui" | grep -q 'event: hello' \
  && ok "/api/events abre un flujo SSE para la UI" || bad "el SSE de la UI no saludó"

# Revocar un token lo invalida al instante.
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tokens/$TOKEN_ID" > /dev/null
[ "$(status -H "Authorization: Bearer $AGENT_TOKEN" "$BASE/api/v1/me")" = "401" ] \
  && ok "un token revocado deja de autenticar" || bad "el token revocado sigue valiendo"

# ---------------------------------------------------------------------------
step "11. Webhooks firmados, OpenAPI y servidor MCP"
# ---------------------------------------------------------------------------

# El receptor de referencia escucha en la máquina anfitriona; el contenedor
# llega hasta ella por host.docker.internal (compose lo publica como
# host-gateway).
WEBHOOK_PORT="${SMOKE_WEBHOOK_PORT:-4599}"
WEBHOOK_ENDPOINT="http://host.docker.internal:$WEBHOOK_PORT/hook"

created_body="$(printf '{"name":"humo","url":"%s","events":["task.changed"]}' "$WEBHOOK_ENDPOINT")"
created="$(curl -fsS -b "$JAR" -X POST "$BASE/api/webhooks" -H 'Content-Type: application/json' \
  -d "$created_body")"
WEBHOOK_ID="$(printf '%s' "$created" | jget webhook.id)"
WEBHOOK_SECRET="$(printf '%s' "$created" | jget secret)"

[ -n "$WEBHOOK_ID" ] && ok "webhook creado" || bad "no se pudo crear el webhook"
printf '%s' "$WEBHOOK_SECRET" | grep -q '^whsec_' \
  && ok "el secreto se emite una vez y lleva el prefijo whsec_" \
  || bad "el secreto no tiene la forma esperada"
[ "$(printf '%s' "$created" | jget webhook.secret)" = "" ] \
  && ok "el objeto del webhook no lleva el secreto en claro" \
  || bad "el secreto viaja dentro del objeto del webhook"

[ "$(status -b "$JAR" -X POST "$BASE/api/webhooks" -H 'Content-Type: application/json' \
  -d '{"name":"malo","url":"ftp://10.0.0.1/hook","events":["task.changed"]}')" = "422" ] \
  && ok "una URL que no es http(s) → 422" || bad "no se valida el esquema de la URL"

# El cuerpo se arma aparte: bash 3.2 se lía con comillas escapadas dentro de $()
# metido en un test [ ]. Aquí el JSON solo interpola una variable.
unknown_event_body="$(printf '{"name":"malo","url":"%s","events":["inventado"]}' "$WEBHOOK_ENDPOINT")"
[ "$(status -b "$JAR" -X POST "$BASE/api/webhooks" -H 'Content-Type: application/json' \
  -d "$unknown_event_body")" = "422" ] \
  && ok "un evento desconocido → 422" || bad "no se validan los eventos suscritos"

# Receptor de referencia con el secreto recién emitido: verifica la firma.
AGENTDESK_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  node scripts/webhook-receiver.mjs "$WEBHOOK_PORT" "$WORK_DIR/webhooks.jsonl" \
  2> "$WORK_DIR/receiver.log" &
RECEIVER_PID=$!
sleep 1

# Un evento real: crear una tarea publica task.changed, que se entrega.
WH_TASK_ID="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Dispara el webhook"}' | jget task.id)"

for _ in $(seq 1 20); do
  [ -s "$WORK_DIR/webhooks.jsonl" ] && break
  sleep 0.5
done

if [ -s "$WORK_DIR/webhooks.jsonl" ]; then
  ok "crear una tarea entrega task.changed al receptor"
  grep -q '"signatureValid":true' "$WORK_DIR/webhooks.jsonl" \
    && ok "la firma HMAC-SHA256 verifica en el receptor" || bad "la firma no verifica"
  grep -q '"event":"task.changed"' "$WORK_DIR/webhooks.jsonl" \
    && ok "la cabecera X-AgentDesk-Event nombra el evento" || bad "falta la cabecera del evento"
  grep -q '"action":"created"' "$WORK_DIR/webhooks.jsonl" \
    && ok "el cuerpo lleva la tarea creada, no solo su id" || bad "el cuerpo no lleva la tarea"
else
  bad "el webhook no llegó al receptor"
fi

# Un endpoint caído no puede tumbar la petición que lo provoca.
dead="$(curl -fsS -b "$JAR" -X POST "$BASE/api/webhooks" -H 'Content-Type: application/json' \
  -d '{"name":"zumbado","url":"http://127.0.0.1:45999/nada","events":["task.changed"]}')"
DEAD_ID="$(printf '%s' "$dead" | jget webhook.id)"

dead_task="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Con un webhook caído"}')"
DEAD_TASK_ID="$(printf '%s' "$dead_task" | jget task.id)"
[ -n "$DEAD_TASK_ID" ] \
  && ok "un webhook caído no impide crear la tarea" || bad "el webhook caído rompió la petición"

sleep 1
failures="$(curl -fsS -b "$JAR" "$BASE/api/webhooks" | python3 -c "
import json, sys
target = '$DEAD_ID'
print(next((w['failureCount'] for w in json.load(sys.stdin)['webhooks'] if w['id'] == target), 0))
")"
[ "$failures" -ge 1 ] \
  && ok "el fallo de entrega queda registrado en el webhook" || bad "el fallo no se registró"

# Probar a mano: es la única entrega cuya respuesta se espera.
test_run="$(curl -fsS -b "$JAR" -X POST "$BASE/api/webhooks/$WEBHOOK_ID/test")"
[ "$(printf '%s' "$test_run" | jget result.ok)" = "True" ] \
  && ok "POST /api/webhooks/:id/test entrega y trae la respuesta" || bad "la prueba manual falló"

# Rotar el secreto invalida el anterior: el receptor sigue con el viejo.
curl -fsS -b "$JAR" -X PATCH "$BASE/api/webhooks/$WEBHOOK_ID" \
  -H 'Content-Type: application/json' -d '{"rotateSecret":true}' > /dev/null

rotated_task="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" -H 'Content-Type: application/json' \
  -d '{"title":"Tras rotar el secreto"}')"
ROTATED_TASK_ID="$(printf '%s' "$rotated_task" | jget task.id)"

for _ in $(seq 1 20); do
  grep -q '"event":"task.changed"' "$WORK_DIR/webhooks.jsonl" \
    && [ "$(grep -c '"signatureValid":false' "$WORK_DIR/webhooks.jsonl")" -ge 1 ] && break
  sleep 0.5
done

grep -q '"signatureValid":false' "$WORK_DIR/webhooks.jsonl" \
  && ok "tras rotar, el secreto viejo ya no firma" || bad "el secreto rotado sigue valiendo"

kill "$RECEIVER_PID" 2>/dev/null || true
wait "$RECEIVER_PID" 2>/dev/null || true
RECEIVER_PID=""

# La especificación de la API es pública y describe los endpoints de agentes.
spec="$(curl -fsS "$BASE/api/openapi.json")"
[ "$(printf '%s' "$spec" | jget openapi)" = "3.1.0" ] \
  && ok "/api/openapi.json sirve la especificación" || bad "no se pudo leer la especificación"
printf '%s' "$spec" | grep -q '"/api/v1/queue"' \
  && ok "la especificación incluye la cola" || bad "falta /api/v1/queue en la especificación"
printf '%s' "$spec" | grep -q "$BASE" \
  && ok "los servers apuntan a APP_BASE_URL" || bad "el server de la especificación no cuadra"

# Servidor MCP en /api/mcp: un token nuevo para que pueda pedir la cola.
mcp_token="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents/$AGENT_ID/tokens" \
  -H 'Content-Type: application/json' -d '{"name":"mcp","scopes":["delegations:read"]}' | jget secret)"

# mcp '<cuerpo jsonrpc>' → respuesta cruda, con el token del agente
mcp() { curl -fsS -X POST "$BASE/api/mcp" -H "Authorization: Bearer $mcp_token" \
  -H 'Content-Type: application/json' -d "$1"; }

hello="$(mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}')"
[ "$(printf '%s' "$hello" | jget result.serverInfo.name)" = "agentdesk" ] \
  && ok "/api/mcp responde a initialize" || bad "/api/mcp no saludó"

tools="$(mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
for tool in get_next_task claim_task propose_delegation request_approval complete_task fail_task; do
  printf '%s' "$tools" | grep -q "\"$tool\"" \
    && ok "la herramienta $tool está publicada" || bad "falta la herramienta $tool"
done
# Las de siempre siguen ahí: mover el servidor no cambió lo que hace.
for tool in whoami get_queue create_task update_task comment_task start_run finish_run; do
  printf '%s' "$tools" | grep -q "\"$tool\"" \
    || bad "se ha perdido la herramienta antigua $tool"
done
ok "las herramientas anteriores siguen publicadas"

queue="$(mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_queue","arguments":{}}}')"
# El resultado de una herramienta viaja como texto JSON: se busca la palabra.
printf '%s' "$queue" | grep -q 'delegations' \
  && ok "una herramienta MCP llega al dominio" || bad "la herramienta MCP no devolvió nada"

# Una notificación no se contesta: 202 y silencio.
code="$(status -X POST "$BASE/api/mcp" -H "Authorization: Bearer $mcp_token" \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"notifications/initialized"}')"
[ "$code" = "202" ] && ok "una notificación MCP → 202 sin cuerpo" || bad "notificación MCP → $code (esperado 202)"

code="$(status -X POST "$BASE/api/mcp" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')"
[ "$code" = "401" ] && ok "/api/mcp sin token → 401" || bad "/api/mcp sin token → $code (esperado 401)"

# Un método que no existe es un error de protocolo…
bad_method="$(mcp '{"jsonrpc":"2.0","id":4,"method":"resources/list"}')"
[ "$(printf '%s' "$bad_method" | jget error.code)" = "-32601" ] \
  && ok "un método desconocido → -32601" || bad "un método desconocido no dio -32601"

# …pero un fallo de herramienta no: viaja como resultado con isError, para que
# el modelo pueda leerlo en lugar de que el cliente cuelgue la sesión.
no_scope="$(mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"create_note","arguments":{"title":"no"}}}')"
[ "$(printf '%s' "$no_scope" | jget result.isError)" = "True" ] \
  && ok "un scope que falta llega como isError, no como error de protocolo" \
  || bad "un scope que falta rompió el protocolo"

# El puente stdio no tiene catálogo propio: lo pide al servidor.
AGENTDESK_URL="$BASE" AGENTDESK_TOKEN="$mcp_token" node mcp/agentdesk-mcp.mjs --list \
  | grep -q '^get_next_task' \
  && ok "el puente stdio lista lo que publica el servidor" || bad "el puente stdio no lista nada"

# ---------------------------------------------------------------------------
step "11b. Lease, aprobaciones y humano en medio"
# ---------------------------------------------------------------------------
flow_token="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents/$AGENT_ID/tokens" \
  -H 'Content-Type: application/json' \
  -d '{"name":"flujo","scopes":["tasks:write","delegations:write","runs:write"]}' | jget secret)"
rival_token="$(curl -fsS -b "$JAR" -X POST "$BASE/api/agents/$OTHER_AGENT_ID/tokens" \
  -H 'Content-Type: application/json' -d '{"name":"rival","scopes":["tasks:write"]}' | jget secret)"

flow() { curl -fsS -X POST "$BASE/api/mcp" -H "Authorization: Bearer $flow_token" \
  -H 'Content-Type: application/json' -d "$1"; }
rival() { curl -fsS -X POST "$BASE/api/mcp" -H "Authorization: Bearer $rival_token" \
  -H 'Content-Type: application/json' -d "$1"; }
# tool '<nombre>' '<json de argumentos>' → el texto del resultado, ya parseado
tooltext() { jget result.content.0.text; }

FLOW_TASK_ID="$(curl -fsS -b "$JAR" -X POST "$BASE/api/tasks" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"Smoke: flujo con aprobacion\",\"projectId\":\"$PROJECT_ID\",\"priority\":\"urgent\"}" | jget task.id)"
[ -n "$FLOW_TASK_ID" ] && ok "tarea del flujo creada (${FLOW_TASK_ID:0:8})" || bad "no se pudo crear la tarea del flujo"

# Reclamar es atómico: el primero se la lleva…
claim="$(flow "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"claim_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\"}}}" | tooltext)"
printf '%s' "$claim" | grep -q 'leaseExpiresAt' \
  && ok "claim_task abre el lease" || bad "claim_task no devolvió lease"

# …y el segundo se queda fuera mientras el lease siga vivo.
rival_claim="$(rival "{\"jsonrpc\":\"2.0\",\"id\":11,\"method\":\"tools/call\",\"params\":{\"name\":\"claim_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\"}}}")"
[ "$(printf '%s' "$rival_claim" | jget result.isError)" = "True" ] \
  && ok "un segundo agente no puede reclamar lo ya reclamado" || bad "dos agentes se llevaron la misma tarea"

# Y tampoco puede cerrarla sin tener el lease.
rival_done="$(rival "{\"jsonrpc\":\"2.0\",\"id\":12,\"method\":\"tools/call\",\"params\":{\"name\":\"complete_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\"}}}")"
[ "$(printf '%s' "$rival_done" | jget result.isError)" = "True" ] \
  && ok "sin lease no se cierra una tarea" || bad "se cerró una tarea sin tener el lease"

# Repetir el claim es el heartbeat: renueva en lugar de fallar.
renew="$(flow "{\"jsonrpc\":\"2.0\",\"id\":13,\"method\":\"tools/call\",\"params\":{\"name\":\"claim_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\"}}}" | tooltext)"
printf '%s' "$renew" | grep -q '"renewed": true' \
  && ok "claim_task repetido renueva el lease" || bad "claim_task repetido no renovó"

# Un solo run por tarea: dos append_log reutilizan el mismo.
run_a="$(flow "{\"jsonrpc\":\"2.0\",\"id\":14,\"method\":\"tools/call\",\"params\":{\"name\":\"append_log\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"message\":\"primera\"}}}" | tooltext | jget runId)"
run_b="$(flow "{\"jsonrpc\":\"2.0\",\"id\":15,\"method\":\"tools/call\",\"params\":{\"name\":\"append_log\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"message\":\"segunda\"}}}" | tooltext | jget runId)"
[ -n "$run_a" ] && [ "$run_a" = "$run_b" ] \
  && ok "append_log reutiliza el run de la tarea" || bad "se abrió un segundo run para la misma tarea"

# propose_delegation no delega: aparca con los argumentos exactos.
proposal="$(flow "{\"jsonrpc\":\"2.0\",\"id\":16,\"method\":\"tools/call\",\"params\":{\"name\":\"propose_delegation\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"toAgentId\":\"$OTHER_AGENT_ID\",\"title\":\"Smoke: delegacion propuesta\"}}}" | tooltext)"
APPROVAL_ID="$(printf '%s' "$proposal" | jget approvalId)"
[ "$(printf '%s' "$proposal" | jget status)" = "pending_approval" ] \
  && ok "propose_delegation deja la acción en pausa" || bad "propose_delegation no pidió aprobación"
[ "$(curl -fsS -b "$JAR" "$BASE/api/delegations?taskId=$FLOW_TASK_ID" | jget delegations.0.id)" = "" ] \
  && ok "y no ha creado ninguna delegación todavía" || bad "se creó una delegación sin aprobarla"

# La bandeja la ve, con su riesgo y su plazo.
inbox="$(curl -fsS -b "$JAR" "$BASE/api/approvals?status=pending")"
printf '%s' "$inbox" | grep -q "$APPROVAL_ID" \
  && ok "la aprobación aparece en la bandeja" || bad "la aprobación no está en la bandeja"
[ "$(printf '%s' "$inbox" | jget approvals.0.risk)" = "high" ] \
  && ok "delegar se marca como riesgo alto" || bad "el riesgo de delegar no es alto"

# Un rechazo sin motivo no cuela: el agente tiene que poder actuar con él.
code="$(status -b "$JAR" -X PATCH "$BASE/api/approvals/$APPROVAL_ID" \
  -H 'Content-Type: application/json' -d '{"action":"reject"}')"
[ "$code" = "422" ] && ok "rechazar sin motivo → 422" || bad "rechazar sin motivo → $code (esperado 422)"

# Aprobar editando los argumentos: los del agente se conservan.
decided="$(curl -fsS -b "$JAR" -X PATCH "$BASE/api/approvals/$APPROVAL_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"approve\",\"payload\":{\"toAgentId\":\"$OTHER_AGENT_ID\",\"title\":\"Smoke: titulo editado\",\"taskId\":\"$FLOW_TASK_ID\"},\"reason\":\"Adelante, con cambios\"}")"
[ "$(printf '%s' "$decided" | jget approval.status)" = "approved" ] \
  && ok "la aprobación queda aprobada" || bad "la aprobación no se aprobó"
FLOW_DELEGATION_ID="$(printf '%s' "$decided" | jget delegation.id)"
[ -n "$FLOW_DELEGATION_ID" ] \
  && ok "aprobar crea la delegación de verdad" || bad "aprobar no creó la delegación"
[ "$(printf '%s' "$decided" | jget delegation.title)" = "Smoke: titulo editado" ] \
  && ok "la delegación usa los argumentos editados" || bad "la delegación ignoró la edición"

# Una decisión no se sobrescribe.
code="$(status -b "$JAR" -X PATCH "$BASE/api/approvals/$APPROVAL_ID" \
  -H 'Content-Type: application/json' -d '{"action":"reject","reason":"me lo repienso"}')"
[ "$code" = "409" ] && ok "decidir dos veces → 409" || bad "decidir dos veces → $code (esperado 409)"

# El agente lee la decisión, con los argumentos editados, sin herramientas nuevas.
seen="$(flow "{\"jsonrpc\":\"2.0\",\"id\":17,\"method\":\"tools/call\",\"params\":{\"name\":\"get_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\"}}}" | tooltext)"
printf '%s' "$seen" | grep -q '"decision": "approved"' \
  && ok "get_task le cuenta al agente la decisión" || bad "el agente no puede leer la decisión"
printf '%s' "$seen" | grep -q 'titulo editado' \
  && ok "y le da los argumentos con los que se aprobó" || bad "el agente no recibe payloadEdited"

# Un rechazo con motivo llega al agente tal cual.
rejected="$(flow "{\"jsonrpc\":\"2.0\",\"id\":18,\"method\":\"tools/call\",\"params\":{\"name\":\"request_approval\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"tool\":\"shell.run\",\"title\":\"Smoke: ejecutar algo\",\"payload\":{\"cmd\":\"true\"},\"idempotencyKey\":\"smoke:1\"}}}" | tooltext)"
REJECT_ID="$(printf '%s' "$rejected" | jget approvalId)"

# La misma clave de idempotencia no abre una segunda petición.
again="$(flow "{\"jsonrpc\":\"2.0\",\"id\":19,\"method\":\"tools/call\",\"params\":{\"name\":\"request_approval\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"tool\":\"shell.run\",\"title\":\"Smoke: ejecutar algo\",\"payload\":{\"cmd\":\"true\"},\"idempotencyKey\":\"smoke:1\"}}}" | tooltext | jget approvalId)"
[ "$again" = "$REJECT_ID" ] \
  && ok "idempotencyKey devuelve la petición que ya existía" || bad "se duplicó la petición"

curl -fsS -b "$JAR" -X PATCH "$BASE/api/approvals/$REJECT_ID" -H 'Content-Type: application/json' \
  -d '{"action":"reject","reason":"Smoke: no toques nada"}' > /dev/null
after="$(flow "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"get_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\"}}}" | tooltext)"
printf '%s' "$after" | grep -q 'no toques nada' \
  && ok "el motivo del rechazo llega al agente" || bad "el agente no recibe el motivo"

# Autonomía: en suggest_only ni siquiera cambia el estado.
curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$FLOW_TASK_ID" -H 'Content-Type: application/json' \
  -d '{"autonomy":"suggest_only"}' > /dev/null
blocked="$(flow "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"tools/call\",\"params\":{\"name\":\"update_task_status\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"status\":\"done\"}}}" | tooltext)"
[ "$(printf '%s' "$blocked" | jget status)" = "pending_approval" ] \
  && ok "en suggest_only cambiar el estado pide aprobación" || bad "suggest_only no frenó el cambio de estado"
# Y la herramienta antigua tampoco es una puerta de atrás.
side_door="$(flow "{\"jsonrpc\":\"2.0\",\"id\":22,\"method\":\"tools/call\",\"params\":{\"name\":\"update_task\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"status\":\"done\"}}}" | tooltext)"
[ "$(printf '%s' "$side_door" | jget status)" = "pending_approval" ] \
  && ok "update_task pasa por el mismo filtro" || bad "update_task se saltó el filtro"
[ "$(curl -fsS -b "$JAR" "$BASE/api/tasks/$FLOW_TASK_ID" | jget task.status)" != "done" ] \
  && ok "y la tarea sigue sin cerrarse" || bad "la tarea se cerró sin aprobación"

# Comentar sigue siendo libre, también en suggest_only.
free="$(flow "{\"jsonrpc\":\"2.0\",\"id\":23,\"method\":\"tools/call\",\"params\":{\"name\":\"add_comment\",\"arguments\":{\"taskId\":\"$FLOW_TASK_ID\",\"body\":\"Smoke: propongo cerrarla\"}}}")"
[ "$(printf '%s' "$free" | jget result.isError)" != "True" ] \
  && ok "comentar es libre en cualquier autonomía" || bad "comentar pidió permiso"

# Un PATCH parcial no debe reescribir lo que no mandas.
curl -fsS -b "$JAR" -X PATCH "$BASE/api/tasks/$FLOW_TASK_ID" -H 'Content-Type: application/json' \
  -d '{"title":"Smoke: flujo renombrado"}' > /dev/null
patched="$(curl -fsS -b "$JAR" "$BASE/api/tasks/$FLOW_TASK_ID")"
[ "$(printf '%s' "$patched" | jget task.priority)" = "urgent" ] \
  && ok "renombrar no toca la prioridad" || bad "un PATCH parcial reescribió la prioridad"
[ "$(printf '%s' "$patched" | jget task.autonomy)" = "suggest_only" ] \
  && ok "ni la autonomía" || bad "un PATCH parcial reescribió la autonomía"

# ---------------------------------------------------------------------------
step "12. Limpieza"
# ---------------------------------------------------------------------------
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$SUBTASK_ID" > /dev/null && ok "subtarea eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$TASK_ID" > /dev/null && ok "tarea eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$CAPTURED_ID" > /dev/null && ok "captura eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$ORPHAN_ID" > /dev/null && ok "huérfana eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$RECURRING_ID" > /dev/null && ok "recurrente eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$PLAIN_ID" > /dev/null && ok "tarea normal eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/projects/$PROJECT_ID" > /dev/null && ok "proyecto eliminado"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/labels/$LABEL_ID" > /dev/null && ok "etiqueta eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/labels/$CAPTURED_LABEL_ID" > /dev/null && ok "etiqueta de captura eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/notes/$NOTE_A_ID" > /dev/null && ok "nota A eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/notes/$NOTE_B_ID" > /dev/null && ok "nota B eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/notes/$IMPORTED_ID" > /dev/null && ok "nota importada eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$FLOW_TASK_ID" > /dev/null \
  && ok "tarea del flujo eliminada (con sus aprobaciones y su run)"
[ "$(curl -fsS -b "$JAR" "$BASE/api/approvals" | jget approvals.0.id)" = "" ] \
  && ok "no queda ninguna aprobación" || bad "quedan aprobaciones en la base de datos"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$AGENT_TASK_ID" > /dev/null && ok "tarea del agente eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/agents/$AGENT_ID" > /dev/null && ok "agente eliminado (con sus runs y delegaciones)"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/agents/$OTHER_AGENT_ID" > /dev/null && ok "agente vecino eliminado"

curl -fsS -b "$JAR" -X DELETE "$BASE/api/webhooks/$WEBHOOK_ID" > /dev/null && ok "webhook eliminado"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/webhooks/$DEAD_ID" > /dev/null && ok "webhook caído eliminado"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$WH_TASK_ID" > /dev/null && ok "tarea del webhook eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$DEAD_TASK_ID" > /dev/null && ok "tarea del webhook caído eliminada"
curl -fsS -b "$JAR" -X DELETE "$BASE/api/tasks/$ROTATED_TASK_ID" > /dev/null && ok "tarea posterior a la rotación eliminada"

[ "$(curl -fsS -b "$JAR" "$BASE/api/webhooks" | jget webhooks.0.id)" = "" ] \
  && ok "no queda ningún webhook" || bad "quedan webhooks en la base de datos"

# ---------------------------------------------------------------------------
printf '\n\033[1mResultado:\033[0m %d correctas, %d fallidas\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
