#!/usr/bin/env bash
#
# Datos de ejemplo para AgentDesk.
#
#   SEED_EMAIL=tu@email SEED_PASSWORD=tu-contraseña ./scripts/seed.sh
#
# Crea un espacio de trabajo con pinta de haberlo usado alguien durante una
# semana: dos proyectos, etiquetas, tareas (vencida, de hoy, próxima y
# recurrente), notas enlazadas con [[wikilinks]], un agente con su token, una
# delegación aprobada y un run en marcha con logs y un artefacto.
#
# Sirve para ver la interfaz con contenido real, y para probar la API de agentes
# sin tener que inventarse datos a mano. Se puede repetir sin duplicar nada: si
# encuentra el proyecto de ejemplo, se planta (FORCE=1 para ignorarlo).
#
# Todo pasa por la API pública, así que los datos son válidos por construcción.
#
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

BASE="${APP_BASE_URL:-}"
if [ -z "$BASE" ] && [ -f .env ]; then
  BASE="$(grep -E '^APP_BASE_URL=' .env | cut -d= -f2-)"
fi
[ -n "$BASE" ] || { printf 'No encuentro APP_BASE_URL (ni en el entorno ni en .env)\n' >&2; exit 1; }

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

EMAIL="${SEED_EMAIL:-}"
PASSWORD="${SEED_PASSWORD:-}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  cat >&2 <<'AYUDA'
Faltan las credenciales del usuario.

  SEED_EMAIL=tu@email SEED_PASSWORD=tu-contraseña ./scripts/seed.sh

El usuario tiene que existir ya (se crea en /setup o con scripts/reset-password.sh).
AYUDA
  exit 1
fi

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }

# jget '<clave>.<subclave>' → lee JSON de stdin (devuelve '' si no existe)
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

# Cuerpo JSON con interpolación, sin comillas anidadas dentro de $().
json() { printf "$1" "${@:2}"; }

get()   { curl -fsS -b "$JAR" "$BASE$1"; }
post()  { curl -fsS -b "$JAR" -X POST "$BASE$1" -H 'Content-Type: application/json' -d "$2"; }
patch() { curl -fsS -b "$JAR" -X PATCH "$BASE$1" -H 'Content-Type: application/json' -d "$2"; }
as_agent() { curl -fsS -H "Authorization: Bearer $AGENT_TOKEN" "$@"; }

# ---------------------------------------------------------------------------
# Fechas del ejemplo
# ---------------------------------------------------------------------------

read -r TODAY OVERDUE SOON LATER <<EOF
$(python3 - <<'PY'
import datetime

today = datetime.date.today()
print(
    today,
    today - datetime.timedelta(days=3),
    today + datetime.timedelta(days=1),
    today + datetime.timedelta(days=6),
)
PY
)
EOF

# ---------------------------------------------------------------------------
step "1. Autenticación"
# ---------------------------------------------------------------------------

info "entrando como ${EMAIL}…"
curl -fsS -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(json '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")" > /dev/null \
  || { printf 'No se pudo iniciar sesión. ¿Están bien SEED_EMAIL y SEED_PASSWORD?\n' >&2; exit 1; }

if [ "${FORCE:-0}" != "1" ]; then
  existing="$(get /api/projects?includeArchived=1 | python3 -c "
import json, sys
print(next((p['id'] for p in json.load(sys.stdin)['projects'] if p.get('identifier') == 'REF'), ''))
")"
  if [ -n "$existing" ]; then
    printf '\nEste espacio ya tiene los datos de ejemplo (proyecto «REF»).\n'
    printf 'Si de verdad quieres duplicarlos: FORCE=1 ./scripts/seed.sh\n\n'
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
step "2. Etiquetas"
# ---------------------------------------------------------------------------

# Dar de alta una etiqueta es idempotente por nombre: la API devuelve la que ya
# existe en vez de fallar, así que el script se puede repetir sin miedo.
ensure_label() {
  post /api/labels "$(json '{"name":"%s","color":"%s"}' "$1" "$2")" | jget label.id
}

CASA="$(ensure_label casa '#f59e0b')"
COMPRAS="$(ensure_label compras '#10b981')"
REVISAR="$(ensure_label revisar '#6366f1')"
info "casa, compras y revisar listas"

# ---------------------------------------------------------------------------
step "3. Proyectos"
# ---------------------------------------------------------------------------

REF_ID="$(post /api/projects "$(json '{"name":"Reforma del salón","identifier":"REF","color":"#f59e0b","description":"Presupuestos, materiales y obra.","targetDate":"%s"}' "$LATER")" | jget project.id)"
PROX_ID="$(post /api/projects "$(json '{"name":"Curso de Proxmox","identifier":"PROX","color":"#6366f1","description":"Pasar todo a virtualización en el mini PC."}')" | jget project.id)"

info "«Reforma del salón» (REF) y «Curso de Proxmox» (PROX)"

# ---------------------------------------------------------------------------
step "4. Agente y token"
# ---------------------------------------------------------------------------

AGENT_ID="$(post /api/agents '{"name":"Investigador","description":"Lee fuentes, resume y deja informes como artefactos.","capabilities":["revisar CVEs","resumir documentación","buscar en la web"]}' | jget agent.id)"

AGENT_TOKEN="$(post "/api/agents/$AGENT_ID/tokens" '{"name":"principal","scopes":["tasks:read","tasks:write","notes:read","notes:write","projects:read","delegations:read","delegations:write","runs:read","runs:write","activity:read"]}' | jget secret)"

info "agente «Investigador» creado con un token de acceso completo"

# ---------------------------------------------------------------------------
step "5. Tareas"
# ---------------------------------------------------------------------------

# Cada tarea se crea y se le añaden sus modificadores; el orden importa poco,
# pero se agrupan por proyecto para que la lectura del script siga el de la UI.
TASK_BUDGET="$(post /api/tasks "$(json '{"title":"Pedir tres presupuestos al albañil","description":"Uno de los que vino en 2024 ya no trabaja en la zona.","status":"in_progress","priority":"high","projectId":"%s","dueDate":"%s","labelIds":["%s"]}' "$REF_ID" "$SOON" "$CASA")" | jget task.id)"
post /api/tasks "$(json '{"title":"Llamar a Marta","parentTaskId":"%s"}' "$TASK_BUDGET")" > /dev/null
post /api/tasks "$(json '{"title":"Escribir a los del polígono","parentTaskId":"%s"}' "$TASK_BUDGET")" > /dev/null

post /api/tasks "$(json '{"title":"Elegir el suelo del salón","description":"Porcelánico imitación madera, 20x120. Comparar tonos a la luz del salón.","status":"todo","priority":"normal","projectId":"%s","dueDate":"%s","labelIds":["%s","%s"]}' "$REF_ID" "$TODAY" "$CASA" "$REVISAR")" > /dev/null

post /api/tasks "$(json '{"title":"Comprar pintura blanca mate","status":"backlog","priority":"low","projectId":"%s","labelIds":["%s"]}' "$REF_ID" "$COMPRAS")" > /dev/null

TASK_PROXMOX="$(post /api/tasks "$(json '{"title":"Instalar Proxmox en el mini PC","description":"Un solo nodo, ZFS con un SSD y otro para las copias.","status":"in_progress","priority":"high","projectId":"%s","dueDate":"%s"}' "$PROX_ID" "$TODAY")" | jget task.id)"
post /api/tasks "$(json '{"title":"Descargar la ISO","parentTaskId":"%s","status":"done"}' "$TASK_PROXMOX")" > /dev/null
post /api/tasks "$(json '{"title":"Preparar el USB de arranque","parentTaskId":"%s"}' "$TASK_PROXMOX")" > /dev/null

post /api/tasks "$(json '{"title":"Migrar AgentDesk a la máquina virtual","description":"Mismo docker-compose.yml; solo cambia la máquina.","status":"todo","priority":"normal","projectId":"%s","dueDate":"%s"}' "$PROX_ID" "$LATER")" > /dev/null

# Sin proyecto ni fecha: esto es el Inbox.
post /api/tasks "$(json '{"title":"Devolver el libro a la biblioteca","status":"todo","priority":"normal","dueDate":"%s"}' "$OVERDUE")" > /dev/null
post /api/tasks "$(json '{"title":"Revisar el correo del banco","status":"todo","priority":"normal","dueDate":"%s","recurrence":"FREQ=MONTHLY"}' "$TODAY")" > /dev/null

TASK_CVES="$(post /api/tasks "$(json '{"title":"Revisar los CVEs del mes","description":"Inventario de la LAN y priorizar críticos.","status":"todo","priority":"urgent","labelIds":["%s"],"assigneeType":"agent","assigneeId":"%s"}' "$REVISAR" "$AGENT_ID")" | jget task.id)"

info "9 tareas (una vencida, dos de hoy, dos próximas, una recurrente y una delegada)"

# ---------------------------------------------------------------------------
step "6. Notas enlazadas"
# ---------------------------------------------------------------------------

NOTE_PLAN="$(post /api/notes "$(json '{"title":"Plan de migración a Proxmox","projectId":"%s","contentMd":"# Plan de migración\\n\\nTodo lo que corre en el Mac mini tiene que acabar en una VM del mini PC, sin tocar la configuración.\\n\\n## Pasos\\n\\n- [x] Instalar Proxmox\\n- [ ] Crear la VM\\n- [ ] Pasar el volumen `pgdata`\\n- [ ] Cambiar la IP en `APP_BASE_URL`\\n\\n## Decisiones\\n\\n| Tema | Decisión |\\n|---|---|\\n| Almacenamiento | ZFS con un SSD para VM y otro para copias |\\n| Red | IP fija en la LAN y Tailscale para fuera |\\n\\n> El mismo `docker-compose.yml` sirve en las dos máquinas; ver [[Dónde vive AgentDesk]].\\n"}' "$PROX_ID")" | jget note.id)"

post /api/notes "$(json '{"title":"Dónde vive AgentDesk","contentMd":"# Dónde vive AgentDesk\\n\\nAhora mismo en el Mac mini, a la espera de [[Plan de migración a Proxmox]].\\n\\n## Lo que hay que llevarse\\n\\n1. El fichero `.env`\\n2. El volumen `pgdata`\\n3. El volumen `uploads`\\n\\n```bash\\n./scripts/backup.sh\\n```\\n\\nLos pasos largos están en [[Plan de migración a Proxmox]].\\n"}' )" > /dev/null

post /api/notes "$(json '{"title":"Presupuesto de la reforma","projectId":"%s","contentMd":"# Presupuesto de la reforma\\n\\n## Albañilería\\n\\n- Picar el suelo: 1.200 €\\n- Nivelar: 480 €\\n\\n## Material\\n\\n- Porcelánico: 38 €/m²\\n- Pintura: 60 €\\n\\nVer [[Plan de migración a Proxmox]] solo si sobra tiempo.\\n"}' "$REF_ID")" > /dev/null

info "3 notas, con [[wikilinks]] y backlinks resueltos al crearlas"

# ---------------------------------------------------------------------------
step "7. Delegación aprobada"
# ---------------------------------------------------------------------------

DELEGATION_ID="$(post /api/delegations "$(json '{"toAgentId":"%s","title":"Revisar los CVEs del mes","instructions":"Solo críticos y altos. Deja un informe en Markdown como artefacto.","taskId":"%s","requiresApproval":true}' "$AGENT_ID" "$TASK_CVES")" | jget delegation.id)"

# El humano aprueba: sin esto la delegación no aparecería en la cola del agente.
patch "/api/delegations/$DELEGATION_ID" '{"action":"approve"}' > /dev/null

info "delegación creada y aprobada (aparece en la cola de /api/v1/queue)"

# ---------------------------------------------------------------------------
step "8. Run en marcha, con logs y artefacto"
# ---------------------------------------------------------------------------

# A partir de aquí se habla como el agente: mismo token que usaría de verdad.
RUN_ID="$(as_agent -X POST "$BASE/api/v1/runs" -H 'Content-Type: application/json' \
  -d "$(json '{"delegationId":"%s","taskId":"%s","status":"running","input":{"rango":"últimos 30 días","alcance":"LAN"}}' "$DELEGATION_ID" "$TASK_CVES")" | jget run.id)"

as_agent -X POST "$BASE/api/v1/runs/$RUN_ID/logs" -H 'Content-Type: application/json' \
  -d '{"logs":[{"level":"info","message":"Consultando el inventario de la LAN"},{"level":"info","message":"42 hosts encontrados"},{"level":"warn","message":"3 hosts sin parchear desde 2024"}]}' > /dev/null

as_agent -X POST "$BASE/api/v1/runs/$RUN_ID/artifacts" -H 'Content-Type: application/json' \
  -d '{"name":"resumen.md","kind":"text","content":"# Resumen del mes\n\n- 42 hosts revisados\n- 3 sin parchear\n\n## Detalle\n\n- `srv-viejo` (192.168.1.30): OpenSSL 1.1.1\n- `impresora`: firmware de 2019\n- `nas`: Samba antiguo\n"}' > /dev/null

as_agent -X POST "$BASE/api/v1/tasks/$TASK_CVES/comments" -H 'Content-Type: application/json' \
  -d '{"body":"Terminado el inventario. Dejo el informe en el run y aviso si hay que tocar producción."}' > /dev/null

# El run queda en marcha a propósito: así la ficha del agente y el historial de
# runs muestran de verdad un flujo en vivo, con su delegación en curso.
info "run abierto con 3 líneas de log, un artefacto y un comentario en la tarea"

# ---------------------------------------------------------------------------
step "Resumen"
# ---------------------------------------------------------------------------

cat <<RESUMEN

  URL base:       $BASE
  Proyectos:      Reforma del salón (REF), Curso de Proxmox (PROX)
  Notas:          Plan de migración a Proxmox ← → Dónde vive AgentDesk
  Agente:         Investigador
  Run abierto:    $BASE/runs/$RUN_ID

  Token del agente «Investigador» (cópialo ahora: no se vuelve a mostrar):

    $AGENT_TOKEN

  Úsalo contra la API:

    curl -H "Authorization: Bearer $AGENT_TOKEN" "$BASE/api/v1/queue"

RESUMEN
