# Integraciones

## Webhooks, OpenAPI y MCP

### Webhooks salientes

Son la vía por la que AgentDesk avisa a otra herramienta: n8n, un script propio, lo que sea. Se
configuran en **Ajustes → Webhooks**.

```bash
BASE="http://192.168.1.50:3000"

# Alta. El secreto de firma se devuelve una sola vez, como el de un token.
curl -s -b cookies.txt -X POST "$BASE/api/webhooks" -H 'Content-Type: application/json' \
  -d '{"name":"n8n","url":"http://192.168.1.50:5678/webhook/agentdesk","events":["task.*","delegation.updated"]}' | jq

# Probar: entrega un evento `test` y espera la respuesta (200, 404, lo que sea).
curl -s -b cookies.txt -X POST "$BASE/api/webhooks/<id>/test" | jq

# Rotar el secreto: el receptor tendrá que actualizarlo.
curl -s -b cookies.txt -X PATCH "$BASE/api/webhooks/<id>" \
  -H 'Content-Type: application/json' -d '{"rotateSecret":true}' | jq
```

Eventos a los que se puede uno suscribir, con la misma nomenclatura que el flujo SSE:

| Evento | Cuándo |
|---|---|
| `task.changed` | Una tarea se crea, se modifica o se borra |
| `task.comment` | Una persona o un agente comenta |
| `note.changed` | Una nota se crea, se edita, se renombra o se borra |
| `delegation.updated` | Cambia el estado de una delegación |
| `task.claimed` | Un agente toma una tarea y abre su lease |
| `approval.requested` | Un agente pide permiso y se queda esperando |
| `approval.decided` | Una aprobación se aprueba, se rechaza, se cancela o caduca |
| `run.updated` | Un run se abre o se cierra |
| `run.artifact` | Un run adjunta un artefacto |
| `run.log` | Cada línea de log (muy hablador) |
| `activity` | Cada acción de la cronología (se solapa con el resto) |

Una suscripción es un nombre exacto, una familia (`task.*` cubre `task.changed` y
`task.comment`) o `*`, que es todo.

**El cuerpo** es siempre el mismo sobre:

```json
{
  "event": "task.changed",
  "at": "2026-01-31T09:12:44.512Z",
  "delivery": "5f0c1a6e-…",
  "webhookId": "a7b1…",
  "data": { "id": "…", "action": "created", "task": { "id": "…", "title": "…" } }
}
```

`data` es lo mismo que viaja por SSE, y es una **notificación**: en `task.changed`, `run.updated`,
`delegation.updated` y `run.artifact` va también el objeto completo para que un receptor típico no
tenga que pedir nada más, pero el cuerpo de una nota o de un artefacto de texto **no se inlina**
(pueden ser cientos de kilobytes). Si el receptor necesita el detalle, lo pide a la API con su
token.

**La firma** es HMAC-SHA256, con el esquema de siempre (el mismo de Stripe), porque permite
rechazar una repetición sin fiarse del reloj:

```
X-AgentDesk-Signature: t=1769841164,v1=6f3a…c21
X-AgentDesk-Event: task.changed
X-AgentDesk-Delivery: 5f0c1a6e-…
```

El contenido firmado es `"<t>.<cuerpo>"` en crudo —el timestamp entra en la firma, así que una
petición capturada no se puede reenviar más tarde— y se compara en tiempo constante, con ±5
minutos de tolerancia entre relojes. Verificarlo son ocho líneas:

```js
const expected = crypto
  .createHmac('sha256', SECRETO)
  .update(`${t}.${cuerpoCrudo}`)
  .digest('hex');
// y comparar con timingSafeEqual, no con ===
```

Hay un receptor de referencia que hace exactamente eso, y que sirve para probar la cadena entera
sin montar n8n:

```bash
AGENTDESK_WEBHOOK_SECRET=whsec_… node scripts/webhook-receiver.mjs 4599 /tmp/agentdesk.jsonl
# y en el alta del webhook:  http://host.docker.internal:4599/hook
```

Tres decisiones que conviene conocer:

- **El secreto se guarda en claro.** No queda otra: firmar exige el valor original, y hashearlo
  aquí no protegería nada porque el receptor tiene el mismo. Se enseña una vez al crearlo o al
  rotarlo, y en la lista solo aparece su prefijo.
- **La entrega es «fire and forget».** Un endpoint caído no puede hacer que falle la acción que
  provocó el aviso: se lanza después de responder y su error se registra con `console.error`. En
  la ficha del webhook sí queda el resultado de las últimas entregas (código HTTP, error, número
  de fallos), que es lo que permite responder a «¿esto está llegando?».
- **No hay reintentos ni cola.** Con una sola instancia local y un receptor en la misma red, un
  reintento silencioso con sus consecuentes duplicados traería más problemas que soluciones. Si
  el receptor es idempotente (n8n lo es por `delivery`), nada impide reintentar por su cuenta.

### Especificación OpenAPI

`GET /api/openapi.json` devuelve la descripción OpenAPI 3.1 de toda la API de agentes, con el
`servers` tomado de `APP_BASE_URL`, así que sirve igual desde cualquier máquina de la LAN. Es
pública a propósito: describe la forma de la API, no sus datos.

```bash
curl -s "$BASE/api/openapi.json" | jq '.paths | keys'
# pégalo en Postman, Insomnia, Bruno o en un generador de clientes
```

### Servidor MCP

AgentDesk expone sus herramientas como un **servidor MCP en `POST /api/mcp`**, dentro de la
propia aplicación: mismo puerto, mismo token de agente y mismos scopes. Habla JSON-RPC 2.0 por
Streamable HTTP.

```bash
curl -s -X POST http://192.168.1.50:3000/api/mcp \
  -H 'Authorization: Bearer agt_…' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
```

En un cliente MCP compatible con Streamable HTTP:

```json
{
  "mcpServers": {
    "agentdesk": {
      "type": "streamable-http",
      "url": "http://192.168.1.50:3000/api/mcp",
      "headers": { "Authorization": "Bearer agt_…" }
    }
  }
}
```

Para clientes que todavía exigen lanzar un proceso hijo hay un puente por `stdio` que reenvía
cada mensaje a esa misma ruta:

```bash
AGENTDESK_URL=http://192.168.1.50:3000 AGENTDESK_TOKEN=agt_… \
  node mcp/agentdesk-mcp.mjs --list
```

El puente no tiene catálogo propio: `tools/list` lo contesta el servidor. Es a propósito, para
que no pueda desviarse de lo que la aplicación publica de verdad.

Un `GET /api/mcp` no abre ningún flujo —el de eventos sigue siendo `/api/v1/events`— pero
contesta diciendo qué es la ruta y qué herramientas hay, que es lo que necesita leer quien
abrió la URL en el navegador.

#### Las herramientas

El flujo «tarea → el agente la revisa → delega o ejecuta»:

| Herramienta | Qué hace | Scope |
|---|---|---|
| `list_tasks` | Lista tareas con su autonomía y su lease | `tasks:read` |
| `get_next_task` | **Reclama** la siguiente tarea que le toca, con lease | `tasks:write` |
| `get_task` | Una tarea con subtareas, comentarios, run abierto y **sus aprobaciones** | `tasks:read` |
| `claim_task` | Reclama una tarea concreta; repetirla **renueva el lease** | `tasks:write` |
| `update_task_status` | Cambia el estado de una tarea que tiene reclamada | `tasks:write` |
| `add_comment` | Comenta. Libre en cualquier autonomía | `tasks:write` |
| `append_log` | Escribe en el run de la tarea; lo abre o reutiliza el abierto | `runs:write` |
| `attach_artifact` | Adjunta texto, una URL o un fichero en base64 | `runs:write` |
| `create_subtask` | Parte una tarea. Hereda la autonomía del padre | `tasks:write` |
| `propose_delegation` | **Propone** pasársela a otro agente. Nunca delega sola | `delegations:write` |
| `request_approval` | Pide permiso para algo que hará él fuera de AgentDesk | `tasks:write` |
| `complete_task` | Cierra la tarea, cierra su run y suelta el lease | `tasks:write` |
| `fail_task` | La abandona con motivo y la deja en revisión | `tasks:write` |

Siguen estando las de siempre, con el mismo nombre y la misma forma: `whoami`, `get_queue`,
`create_task`, `update_task`, `comment_task`, `list_projects`, `list_notes`, `get_note`,
`create_note`, `update_note`, `list_delegations`, `update_delegation`, `start_run`, `log_run`,
`finish_run` y `add_artifact`.

Para las notas hay cuatro herramientas nuevas: `get_note_by_title` (leer por título),
`append_note` (añadir Markdown, creando la nota si no existe), `upsert_note` (crear o reemplazar
por título) y `delete_note` (borrar por id, destructivo). `append_note` y `upsert_note` no
necesitan conocer el `id`, que es como un agente piensa en «el diario de hoy» o «el estado del
despliegue». `list_notes` acepta además `authorType`, `authorId`, `limit` y `offset`.

Las herramientas de notas **no pasan por el flujo de aprobaciones**: una nota no siempre tiene una
tarea a la que colgar la aprobación. El control es el scope `notes:write`, y cada escritura o
borrado queda en la actividad con el agente como autor. Si un token no debe borrar notas, no le
des `notes:write`.

**No hay scopes nuevos.** Los de siempre bastan, y un token al que le falte uno recibe el `403`
con el nombre del que falta, como texto que el modelo puede leer. Un fallo de una herramienta
nunca rompe el protocolo MCP: viaja como un resultado con `isError`.

#### Riesgo y autonomía

Cada herramienta tiene un riesgo fijo. Cada **tarea** tiene una autonomía. El cruce decide:

| Riesgo | `suggest_only` | `do_with_approval` (por defecto) | `autonomous_low_risk` |
|---|---|---|---|
| Leer, comentar, loguear, adjuntar | pasa | pasa | pasa |
| Reclamar, cambiar estado, cerrar | **aprobación** | pasa | pasa |
| Crear subtareas | **aprobación** | pasa, con **aviso** | pasa |
| Delegar, ejecutar, enviar, borrar | **aprobación** | **aprobación** | **aprobación** |

Tres cosas que vale la pena saber:

- **El riesgo alto no lo levanta ninguna autonomía.** Esa columna decide cuánto papeleo quieres,
  no si cedes la autoridad de delegar trabajo o de tocar algo fuera de AgentDesk.
- **Una herramienta desconocida se trata como riesgo alto.** Falla cerrado.
- **`update_task` pasa por el mismo filtro que `update_task_status`.** Si no, sería la forma de
  cambiarle el estado a una tarea en `suggest_only`, y un filtro con una puerta de atrás es
  decoración.

Un `aviso` pasa, pero queda en la cronología con `meta.notice` para que se vea después.

#### El lease

`get_next_task` y `claim_task` **reservan** la tarea: un solo agente a la vez, y solo durante
`AGENTDESK_LEASE_TTL_SECONDS` (15 minutos por defecto). Eso es lo que hace que dos runners en
paralelo sean seguros —cada uno se lleva una tarea distinta, nunca la misma— y lo que permite
recuperar una tarea de un agente que se murió a mitad.

No hay herramienta de heartbeat porque no hace falta: `claim_task` sobre una tarea que ya tienes
renueva el lease, y `append_log`, `add_comment` y `update_task_status` lo renuevan de paso. Un
runner que trabaja es un runner que llama a algo.

Si el lease caduca, la tarea **vuelve a `todo`** y queda apuntado en la actividad. El barrido no
necesita planificador: se hace al leer la cola, al cargar la bandeja y en cada pasada del runner.

#### Cuando algo se queda en pausa

Una herramienta que no puede ejecutarse no falla: devuelve

```json
{
  "status": "pending_approval",
  "approvalId": "…",
  "tool": "propose_delegation",
  "risk": "high",
  "expiresAt": "2026-10-19T17:30:19.985Z",
  "message": "No se ha ejecutado nada: queda en pausa hasta que una persona lo decida…"
}
```

y el agente consulta `get_task`, donde cada aprobación trae `decision` (`pending`, `approved`,
`rejected`), `reason` y `payloadEdited`. Si está aprobada, los argumentos a usar son
`payloadEdited` cuando viene: significa que cambiaste algo. Una aprobación caducada llega como
`rejected`.

Para no abrir dos peticiones iguales al reintentar tras un corte, `request_approval` acepta
`idempotencyKey`: con la misma clave devuelve la que ya existe.

### Un runner para cron

`scripts/task-runner.mjs` es un runner de referencia, sin dependencias y de una pasada por
invocación: no es un demonio, el ritmo lo marca el cron. La línea está en
[Operación](operacion.md#el-runner-en-cron).

Hace, en este orden: mira las tareas **que ya tiene en la mano** (por si has decidido algo
mientras dormía), y solo después pide trabajo nuevo con `get_next_task`. Ese orden importa: un
lease vivo impide que `get_next_task` le devuelva su propia tarea, así que un runner que solo
pidiera trabajo nuevo tardaría un lease entero en leer tu respuesta.

El «cerebro» es un stub con dos reglas tontas a propósito —proponer delegación si la tarea lleva
una etiqueta, pedir permiso si no— y un punto de extensión documentado en la función `decide`.
Lo que de verdad importa es el contrato: `execute` recibe los argumentos **aprobados** y nada
irreversible pasa antes de que tú digas sí.
