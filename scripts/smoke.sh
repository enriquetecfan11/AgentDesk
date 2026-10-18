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
for route in /inbox /today /upcoming /notes; do
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
step "10. Limpieza"
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

# ---------------------------------------------------------------------------
printf '\n\033[1mResultado:\033[0m %d correctas, %d fallidas\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
