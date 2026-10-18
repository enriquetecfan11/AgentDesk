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

`mcp/agentdesk-mcp.mjs` expone la API como **herramientas MCP**, para que un agente con acceso a
esa interfaz trabaje sobre AgentDesk sin escribir una línea de HTTP. No tiene dependencias: se
copia el fichero donde corra el agente.

```bash
AGENTDESK_URL=http://192.168.1.50:3000 AGENTDESK_TOKEN=agt_… \
  node mcp/agentdesk-mcp.mjs --list
```

En Claude Desktop (o cualquier cliente MCP), `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentdesk": {
      "command": "node",
      "args": ["/ruta/a/agentdesk-mcp.mjs"],
      "env": {
        "AGENTDESK_URL": "http://192.168.1.50:3000",
        "AGENTDESK_TOKEN": "agt_…"
      }
    }
  }
}
```

Herramientas: `whoami`, `get_queue`, `list_tasks`, `get_task`, `create_task`, `update_task`,
`comment_task`, `list_projects`, `list_notes`, `get_note`, `create_note`, `update_note`,
`list_delegations`, `update_delegation`, `start_run`, `log_run`, `finish_run` y `add_artifact`.

El token manda: si solo tiene `tasks:read`, las herramientas que escriben devuelven el `403` de la
API y el modelo lo lee como texto. Un fallo de la API nunca rompe el protocolo MCP.
