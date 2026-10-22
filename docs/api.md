# API

## API HTTP

Los endpoints de la izquierda exigen **sesión de usuario** (cookie `ad_session`). Los de
`/api/v1/**` exigen **token de agente** (`Authorization: Bearer agt_…`) y se documentan en
[Agentes y API v1](#agentes-y-api-v1).

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Estado de la app y de la base de datos |
| `GET` | `/api/auth/setup` | `{ available }`: si aún se puede crear el primer usuario |
| `POST` | `/api/auth/setup` | Crea el primer usuario. `409` si ya existe alguno |
| `POST` | `/api/auth/login` | Inicia sesión y emite la cookie |
| `POST` | `/api/auth/logout` | Borra la sesión y la cookie |
| `GET` | `/api/auth/me` | Usuario actual, o `401` |
| `GET` `POST` | `/api/projects` | Listar / crear proyectos (`?includeArchived=1`) |
| `GET` `PATCH` `DELETE` | `/api/projects/:id` | Leer, editar o borrar un proyecto |
| `GET` `POST` | `/api/tasks` | Listar / crear tareas (filtros abajo) |
| `GET` `PATCH` `DELETE` | `/api/tasks/:id` | Leer (con subtareas y actividad), editar o borrar |
| `GET` | `/api/tasks/:id/activity` | Cronología de la tarea: cambios, comentarios y cierres |
| `GET` `POST` | `/api/labels` | Listar / crear etiquetas (idempotente por nombre) |
| `DELETE` | `/api/labels/:id` | Borrar una etiqueta |
| `POST` | `/api/capture` | Una línea de lenguaje natural → una tarea |
| `GET` | `/api/search?q=` | Tareas y proyectos para la paleta (mínimo 2 caracteres) |
| `GET` `POST` | `/api/notes` | Listar / crear notas (`?q=`, `?projectId=`, `?authorType=`, `?authorId=`, `?limit=`, `?offset=`) |
| `GET` `PATCH` `DELETE` | `/api/notes/:id` | Nota con sus backlinks y enlaces salientes |
| `GET` `PUT` | `/api/notes/by-title` | Leer por título (`?title=`) o crear/reemplazar sin conocer el id |
| `POST` | `/api/notes/append` | Añadir Markdown al final; crea la nota si no existe |
| `POST` | `/api/notes/import` | Importar varios `.md` (`{ files: [{ name, content }], overwrite }`) |
| `GET` | `/api/notes/export` | Descargar el vault completo en un `.zip` |
| `GET` `POST` | `/api/agents` | Listar / crear agentes (`?archived=true`) |
| `GET` `PATCH` `DELETE` | `/api/agents/:id` | Agente con sus tokens, delegaciones y runs |
| `GET` `POST` | `/api/agents/:id/tokens` | Listar / emitir tokens (el secreto sale una sola vez) |
| `DELETE` | `/api/tokens/:id` | Revocar un token (`?hard=true` para borrarlo) |
| `GET` `POST` | `/api/delegations` | Listar / crear delegaciones (`?agentId=&taskId=&status=`) |
| `GET` `PATCH` | `/api/delegations/:id` | Leer; aprobar, cancelar o cambiar de estado |
| `GET` | `/api/runs` | Listar runs (`?agentId=&taskId=&status=`) |
| `GET` | `/api/runs/:id` | Run con sus logs y artefactos |
| `GET` | `/api/events` | Flujo SSE de la UI: tareas, runs y actividad en vivo |
| `GET` | `/api/artifacts/:id` | Descargar un artefacto (sesión **o** token con `runs:read`) |
| `GET` | `/api/approvals` | Bandeja de aprobaciones (`?status=`, `?taskId=`, `?agentId=`) |
| `GET` `PATCH` | `/api/approvals/:id` | Leer; aprobar (con argumentos editados), rechazar con motivo o cancelar |
| `GET` `POST` | `/api/webhooks` | Listar / crear salidas (`POST` devuelve el secreto una vez) |
| `GET` `PATCH` `DELETE` | `/api/webhooks/:id` | Leer, editar (`rotateSecret`), borrar |
| `POST` | `/api/webhooks/:id/test` | Entrega un evento `test` y devuelve la respuesta del receptor |
| `GET` | `/api/openapi.json` | Especificación OpenAPI 3.1 de la API de agentes (pública) |
| `POST` | `/api/mcp` | Servidor MCP (token de agente). Ver [Integraciones](integraciones.md) |

Filtros de `GET /api/tasks`, todos opcionales:

| Parámetro | Ejemplo | Efecto |
|---|---|---|
| `projectId` | `?projectId=<uuid>` | Solo ese proyecto |
| `status` | `?status=todo,in_progress` | Lista separada por comas |
| `priority` | `?priority=urgent,high` | Lista separada por comas |
| `assigneeType` | `?assigneeType=agent` | `human` o `agent` |
| `q` | `?q=cve` | Busca en el título (case-insensitive) |
| `dueBefore` | `?dueBefore=2026-01-31` | Fecha límite, inclusive |
| `dueAfter` | `?dueAfter=2026-01-01` | Fecha desde, inclusive |
| `rootOnly` | `?rootOnly=1` | Excluye subtareas |
| `inbox` | `?inbox=1` | Sin proyecto y sin fecha |
| `order` | `?order=dueDate` | `manual`, `dueDate`, `priority`, `created` |

Una tarea lleva además unos campos que solo importan cuando trabaja un agente, y que salen en
todas las respuestas:

| Campo | Qué es |
|---|---|
| `autonomy` | `suggest_only`, `do_with_approval` (por defecto) o `autonomous_low_risk` |
| `claimedByAgentId`, `claimedByAgentName` | Quién tiene el *lease*, si lo tiene alguien |
| `leaseExpiresAt`, `leaseSecondsLeft` | Cuándo caduca la reserva |
| `heartbeatAt` | Última señal de vida del agente |
| `claimCount` | Veces que se ha reclamado. Un número alto delata un bucle |

`autonomy` se puede mandar al crear (`POST /api/tasks`) y al editar (`PATCH /api/tasks/:id`).
Se cambia también desde el panel de detalle de la tarea.

Ejemplo completo:

```bash
curl -s -b cookies.txt 'http://192.168.1.50:3000/api/tasks?status=todo&order=dueDate' | jq
```

Los valores mal formados se descartan en lugar de devolver `422`: un enlace guardado
antiguo debe seguir mostrando algo útil.

---

## Aprobaciones

Una aprobación es **una acción que un agente quiso hacer y no puede hacer sola**. Se crea
sola cuando el agente llama a una herramienta MCP que su autonomía no le permite, y se queda
esperando en **Aprobaciones** hasta que la decidas.

AgentDesk es la puerta, no el ejecutor: aprobar `shell.run` no ejecuta nada, le dice al agente
—que está consultando `get_task`— que ya puede ejecutarlo él. La única acción que AgentDesk
hace por sí misma es la que es suya de principio a fin: aprobar un `propose_delegation` crea la
delegación de verdad.

```bash
# Lo que está esperando
curl -s -b cookies.txt "$BASE/api/approvals?status=pending" | jq

# Aprobar tal cual
curl -s -b cookies.txt -X PATCH "$BASE/api/approvals/<id>" \
  -H 'Content-Type: application/json' -d '{"action":"approve"}' | jq

# Aprobar cambiando los argumentos (el agente usará payloadEdited, no los suyos)
curl -s -b cookies.txt -X PATCH "$BASE/api/approvals/<id>" \
  -H 'Content-Type: application/json' \
  -d '{"action":"approve","payload":{"cmd":"wazuh-control status"},"reason":"Solo consultar"}' | jq

# Rechazar. El motivo es obligatorio: el agente lo recibe y actúa con él.
curl -s -b cookies.txt -X PATCH "$BASE/api/approvals/<id>" \
  -H 'Content-Type: application/json' \
  -d '{"action":"reject","reason":"No reinicies nada en horario laboral"}' | jq
```

Estados: `pending` → `approved` / `rejected` / `cancelled`, más `expired`.

Las cuatro reglas, y dónde se cumplen de verdad:

- **Falla cerrado.** `expires_at` es obligatorio y toda lectura barre antes lo vencido. Al agente
  se le informa con un campo `decision`, y una aprobación caducada llega como `rejected`: nunca
  tiene que saber que hubo un plazo, solo que la respuesta fue no.
- **Una decisión no se sobrescribe.** Decidir es un `UPDATE … WHERE status = 'pending'`. La
  segunda decisión no encaja con ninguna fila y la respuesta es `409` con el estado que sí vale,
  incluido el caso de haberse quedado el diálogo abierto hasta que caducó.
- **Un agente no aprueba lo suyo.** No hay ruta bajo `/api/v1` ni herramienta MCP que decida.
  `decided_by_user_id` apunta a `users` y el único camino es `PATCH /api/approvals/:id` con
  sesión.
- **Un rechazo lleva motivo.** Sin él la respuesta es `422`: un rechazo que el agente no puede
  interpretar es un agente que reintenta lo mismo y vuelve a chocar.

El payload original **nunca se reescribe**. Si editas los argumentos, los tuyos van a
`payloadEdited` y los del agente se quedan en `payload`, así que la bandeja siempre puede
enseñar las dos cosas.

Qué riesgo tiene cada herramienta y qué hace cada autonomía está en
[Integraciones → Servidor MCP](integraciones.md#servidor-mcp).

---

## Agentes y API v1

Un agente es una identidad con **su propio token y sus propios scopes**. No hay login de
agentes ni sesiones: cada petición lleva el token en la cabecera.

```
Authorization: Bearer agt_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Crear un agente y su primer token

Desde la UI: **Agentes → Nuevo agente**, y en su ficha **Crear token**.

Desde la terminal:

```bash
BASE="http://192.168.1.50:3000"

# 1. Crea el agente (necesitas la cookie de sesión del humano)
AGENT_ID=$(curl -s -b cookies.txt -X POST "$BASE/api/agents" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Wazuh triage","description":"Revisa CVEs y propone parches","capabilities":["revisar CVEs","informes"]}' \
  | jq -r .agent.id)

# 2. Emite un token. El valor del campo "secret" solo aparece aquí.
curl -s -b cookies.txt -X POST "$BASE/api/agents/$AGENT_ID/tokens" \
  -H 'Content-Type: application/json' \
  -d '{"name":"n8n","scopes":["tasks:read","tasks:write","delegations:read","delegations:write","runs:read","runs:write"]}' \
  | jq
```

```json
{
  "token": {
    "id": "…", "agentId": "…", "name": "n8n",
    "tokenPrefix": "agt_9f2c1ab",
    "scopes": ["tasks:read", "tasks:write", "delegations:read", "delegations:write", "runs:read", "runs:write"],
    "lastUsedAt": null, "expiresAt": null, "revokedAt": null, "createdAt": "2026-…"
  },
  "secret": "agt_9f2c1ab…"
}
```

Del token se guarda **solo su `sha256`** y un prefijo de 12 caracteres para poder listarlo. No hay
forma de volver a verlo: si se pierde, se revoca y se emite otro. Revocar un token surte efecto
en la siguiente petición, sin caché de por medio.

### Scopes

| Scope | Permite |
|---|---|
| `tasks:read` / `tasks:write` | Leer / crear, editar y borrar tareas |
| `notes:read` / `notes:write` | Leer / escribir notas |
| `projects:read` / `projects:write` | Leer / crear proyectos |
| `delegations:read` / `delegations:write` | Ver la cola / aceptar y cerrar delegaciones |
| `runs:read` / `runs:write` | Leer / abrir runs, escribir logs y adjuntar artefactos |
| `activity:read` | Leer la actividad |

Dos reglas que ahorran configuraciones rotas:

- **Escribir implica leer** en la misma área: `tasks:write` ya concede `tasks:read`.
- Un token también puede llevar `"*"`, que concede todo. La UI no lo ofrece; existe para scripts
  de administración.

Si falta un scope, la respuesta es `403` con el nombre del scope que falta, no un `404`. Un token
inválido, revocado o caducado devuelve `401`.

### Empezar por la cola

```bash
BASE="http://192.168.1.50:3000"
export AD_TOKEN="agt_..."

# ¿Quién soy, qué puedo hacer y cuánto tengo pendiente?
curl -s -H "Authorization: Bearer $AD_TOKEN" "$BASE/api/v1/me" | jq

# Todo lo que tengo que hacer: delegaciones accionables + tareas asignadas
curl -s -H "Authorization: Bearer $AD_TOKEN" "$BASE/api/v1/queue" | jq
```

`/api/v1/me` no exige ningún scope: un token mal configurado puede llamarlo y ver exactamente qué
scopes tiene.

`/api/v1/queue` devuelve dos listas: las **delegaciones** que el agente puede empezar (ni
cerradas ni esperando aprobación humana) y las **tareas** que tiene asignadas y siguen abiertas.
Es el endpoint que un agente consulta al despertar, o para el que se queda escuchando en
`/api/v1/events`.

### Ciclo completo de una delegación

El humano delega (o el propio agente delega en otro):

```bash
curl -s -b cookies.txt -X POST "$BASE/api/delegations" \
  -H 'Content-Type: application/json' \
  -d '{"toAgentId":"'"$AGENT_ID"'","title":"Revisar CVEs del mes","taskId":"'"$TASK_ID"'","instructions":"Solo críticos y altos"}' | jq
```

Con `"requiresApproval": true` la delegación **no aparece en la cola** hasta que la apruebes desde
la ficha del agente. Es la forma de dar trabajo sin dar luz verde.

El agente la trabaja y la cierra:

```bash
DELEGATION_ID="…"

# Aceptar. El campo opcional "note" se añade como comentario en la tarea asociada,
# que es donde tú lo vas a leer.
curl -s -X PATCH "$BASE/api/v1/delegations/$DELEGATION_ID" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"in_progress","note":"Revisando el inventario del último mes"}' | jq

curl -s -X PATCH "$BASE/api/v1/delegations/$DELEGATION_ID" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"completed"}' | jq
```

Estados: `pending` → `accepted` → `in_progress` → `completed` / `failed`, más `rejected` y
`cancelled`. No hay una máquina de estados estricta: un agente que falla y luego lo consigue no
tiene que pedir permiso para volver a intentarlo. Lo que sí se sella es la aprobación humana
(`approvedAt`) cuando la delegación la exigía.

Un agente **solo puede tocar sus propias delegaciones**: si el `toAgentId` no es el suyo, `403`.

### Runs: dejar constancia de lo que pasó

```bash
# Abrir el run (queda ligado a la tarea y a la delegación)
RUN_ID=$(curl -s -X POST "$BASE/api/v1/runs" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"taskId":"'"$TASK_ID"'","delegationId":"'"$DELEGATION_ID"'","status":"running","input":{"rango":"último mes"}}' \
  | jq -r .run.id)
```

Abrir un run sobre una delegación **la pone en `in_progress`**: el agente no tiene que decir lo
mismo dos veces.

```bash
# Logs, en lote o de una en una
curl -s -X POST "$BASE/api/v1/runs/$RUN_ID/logs" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"logs":[{"level":"info","message":"Consultando inventario"},{"level":"warn","message":"3 hosts sin parchear"}]}' | jq

curl -s -X POST "$BASE/api/v1/runs/$RUN_ID/logs" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":"Informe listo"}' | jq

# Recuperar lo que ya hay (útil al reconectar)
curl -s -H "Authorization: Bearer $AD_TOKEN" "$BASE/api/v1/runs/$RUN_ID/logs?since=2026-01-01T00:00:00Z" | jq
```

Cada línea escrita se empuja por SSE al instante, así que la pantalla del run se rellena sola.

Artefactos: lo que el agente produce y quieres conservar.

```bash
# Texto pequeño, en línea
curl -s -X POST "$BASE/api/v1/runs/$RUN_ID/artifacts" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"resumen.md","kind":"text","content":"# Resumen\n- 3 hosts sin parchear"}' | jq

# Fichero, en base64 (se escribe en el volumen "uploads")
curl -s -X POST "$BASE/api/v1/runs/$RUN_ID/artifacts" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"detalle.csv","kind":"file","mimeType":"text/csv","contentBase64":"'"$(base64 < detalle.csv)"'"}' | jq
```

Se usa JSON también para los ficheros (no `multipart/form-data`) para que un agente no necesite
más que un cliente HTTP. El límite está en el esquema: 8 MB en base64.

Cerrar el run:

```bash
curl -s -X PATCH "$BASE/api/v1/runs/$RUN_ID" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"succeeded","output":"3 hosts sin parchear","costUsd":0.042}' | jq
```

El agente manda **el estado, nunca los tiempos**: el servidor sella `startedAt` al entrar en
`running`, y `finishedAt` y `durationMs` al cerrar. Y si el run venía de una delegación, cerrarlo
la cierra con él (`succeeded` → `completed`, cualquier otra cosa → `failed`).

### Server-Sent Events

```bash
curl -N -H "Authorization: Bearer $AD_TOKEN" "$BASE/api/v1/events"
```

```
event: hello
data: {"at":"2026-…","agentId":"…","agentName":"Wazuh triage"}

event: run.log
data: {"id":"…","runId":"…","level":"warn","message":"3 hosts sin parchear",…}

event: delegation.updated
data: {"id":"…","status":"in_progress","agentId":"…"}

event: task.changed
data: {"id":"…","action":"updated"}
```

| Evento | Cuándo |
|---|---|
| `hello` | Al abrir el flujo |
| `run.log` | Cada línea de log |
| `run.updated` | Un run cambia de estado |
| `run.artifact` | Se adjunta un artefacto |
| `delegation.updated` | Cambia una delegación |
| `task.changed`, `note.changed`, `task.comment`, `activity` | Cambios en el resto del workspace |

El flujo del agente **solo recibe sus propios eventos `run.*`**: son datos suyos. Los eventos
genéricos (tareas, actividad) no llevan más que un identificador, porque el agente ya puede pedir
el resto por su cuenta. Un `: keep-alive` cada 25 s mantiene la conexión abierta.

La UI tiene su propio flujo en `/api/events` (con la cookie de sesión). El shell lo escucha y
refresca lo que se esté viendo, con un *debounce* de 400 ms: un run que escribe cincuenta líneas
en un segundo provoca un render, no cincuenta.

### Notas de implementación

- **Los comentarios de tarea son entradas de actividad** (`action = "task.comment"`, el texto en
  `meta.body`). Ya necesitaban lo mismo que la cronología —autor humano o agente, fecha y
  cuerpo—, así que reutilizar la tabla los deja **solo-añadir** y los pone gratis en la actividad
  unificada. El precio, documentado aquí: un comentario no se puede editar ni borrar.
- **Una tarea que abre un agente se le asigna a él** si no dice otra cosa, que es lo que la hace
  aparecer en su propia cola. Reasignarla desde la UI es un clic.
- **El bus de SSE vive en el proceso.** La app corre como un único proceso Node en un contenedor,
  así que no hace falta Redis ni un broker. Si algún día se escala a varias réplicas, `lib/realtime.ts`
  es el único módulo que habría que cambiar.
- **Los artefactos de fichero se borran con su run o con su agente**, antes de que las filas
  desaparezcan en cascada: las filas las borra Postgres, los ficheros los borra la app.
- Cualquier acción de un agente queda en la actividad con `actor_type = 'agent'`, así que todo lo
  que hace es auditable desde `/activity` (hay un filtro **Personas / Agentes**).

### Endpoints de la API v1

| Método | Ruta | Scope |
|---|---|---|
| `GET` | `/api/v1/me` | — |
| `GET` | `/api/v1/queue` | `delegations:read` |
| `GET` `POST` | `/api/v1/tasks` | `tasks:read` / `tasks:write` |
| `GET` `PATCH` `DELETE` | `/api/v1/tasks/:id` | `tasks:read` / `tasks:write` |
| `GET` `POST` | `/api/v1/tasks/:id/comments` | `tasks:read` / `tasks:write` |
| `GET` `POST` | `/api/v1/projects` | `projects:read` / `projects:write` |
| `GET` `POST` | `/api/v1/notes` | `notes:read` / `notes:write` |
| `GET` `PUT` | `/api/v1/notes/by-title` | `notes:read` / `notes:write` |
| `POST` | `/api/v1/notes/append` | `notes:write` |
| `GET` `PATCH` `DELETE` | `/api/v1/notes/:id` | `notes:read` / `notes:write` |
| `GET` `POST` | `/api/v1/delegations` | `delegations:read` / `delegations:write` |
| `GET` `PATCH` | `/api/v1/delegations/:id` | `delegations:read` / `delegations:write` |
| `GET` `POST` | `/api/v1/runs` | `runs:read` / `runs:write` |
| `GET` `PATCH` | `/api/v1/runs/:id` | `runs:read` / `runs:write` |
| `GET` `POST` | `/api/v1/runs/:id/logs` | `runs:read` / `runs:write` |
| `GET` `POST` | `/api/v1/runs/:id/artifacts` | `runs:read` / `runs:write` |
| `GET` | `/api/v1/events` | — (token válido) |

Las notas llevan autoría (`authorType`, `authorId`, `authorName`). `GET /api/v1/notes` pagina con
`limit` y `offset` y devuelve `{ notes, total, limit, offset, nextOffset }`. `POST
/api/v1/notes/append` y `PUT /api/v1/notes/by-title` responden con el detalle de la nota más
`created` (`201` si la crearon, `200` si la modificaron). El título de `by-title` viaja en
`?title=`, no en la ruta, porque puede contener `/`, `#` o acentos.

Los filtros de `/api/v1/tasks` son los mismos que los de `/api/tasks`. Los `id` de agente, tarea,
run y delegación son siempre UUID: un id mal formado devuelve `404`, no un error de base de datos.
