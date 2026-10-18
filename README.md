# AgentDesk

Workspace operativo self-hosted para **una persona y sus agentes de IA**.

Combina lo que aportan herramientas distintas —issues con estados y prioridades (Linear),
captura rápida en lenguaje natural (Todoist), notas en markdown enlazables (Notion) y tablero
Kanban (Trello)— y añade lo que ninguna de ellas tiene: **los agentes de IA son ciudadanos de
primera clase**. Pueden tener tareas asignadas, crear tareas, escribir notas y dejar registro
de sus ejecuciones.

Todo corre en tu propia máquina. Sin servicios externos, sin cuentas, sin telemetría.

---

## Índice

- [Estado del proyecto](#estado-del-proyecto)
- [Arquitectura](#arquitectura)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Variables de entorno](#variables-de-entorno)
- [Cómo crear el primer usuario](#cómo-crear-el-primer-usuario)
- [Comprobar que funciona](#comprobar-que-funciona)
- [API HTTP](#api-http)
- [Captura rápida](#captura-rápida)
- [Atajos de teclado](#atajos-de-teclado)
- [Notas](#notas)
- [Agentes y API v1](#agentes-y-api-v1)
- [Webhooks, OpenAPI y MCP](#webhooks-openapi-y-mcp)
- [Copias de seguridad y migración](#copias-de-seguridad-y-migración)
- [Pruebas](#pruebas)
- [Desarrollo](#desarrollo)
- [Base de datos y migraciones](#base-de-datos-y-migraciones)
- [Estructura del repositorio](#estructura-del-repositorio)

---

## Estado del proyecto

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Esqueleto: repo, Dockerfile multi-arch, compose, Postgres, migraciones, healthchecks | ✅ |
| 2 | Auth + layout + proyectos + tareas (lista y Kanban) | ✅ |
| 3 | Inbox, Today, Upcoming, captura rápida, recurrencias, paleta de comandos | ✅ |
| 4 | Notas con backlinks e import/export markdown | ✅ |
| 5 | Agentes, tokens, API REST v1, delegaciones, runs, SSE | ✅ |
| 6 | Webhooks, OpenAPI, servidor MCP | ✅ |
| 7 | Backup/restore y guía de migración Mac mini → Proxmox | ✅ |
| 8 | Tests, accesibilidad, rendimiento, README final | ⏳ |

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│  Tu LAN / Tailscale                                          │
│                                                              │
│   navegador ──┐        n8n / agentes ──┐                     │
│               │                        │                     │
│               ▼                        ▼                     │
│        ┌────────────────────────────────────────┐            │
│        │  contenedor "app"  (Next.js 16)        │            │
│        │  · UI + Route Handlers                 │            │
│        │  · /api/health                         │            │
│        │  · /api/v1/**  (token de agente)       │            │
│        │  · /api/events (SSE)                   │            │
│        │  · /api/v1/events (SSE de agentes)     │            │
│        │  · webhooks salientes (HMAC-SHA256) ───┼──▶ n8n     │
│        │  · /api/openapi.json                   │            │
│        └────────────────┬───────────────────────┘            │
│                         │  host: "db"                        │
│                         ▼                                    │
│        ┌────────────────────────────────────────┐            │
│        │  contenedor "db"  (Postgres 16)        │            │
│        │  volumen: pgdata                       │            │
│        └────────────────────────────────────────┘            │
│                                                              │
│        volumen: uploads  ← artefactos de los runs            │
└──────────────────────────────────────────────────────────────┘
```

Decisiones de diseño relevantes:

- **El mismo `docker-compose.yml` sirve en el Mac mini (arm64) y en Proxmox (amd64).**
  Las imágenes se construyen en local con `docker compose build`, así que no hacen falta
  registries ni compilación cruzada. Nada en el repositorio depende de macOS.
- **Nunca `localhost` en configuración.** Entre contenedores se usan nombres de servicio
  (`db`); de cara al navegador se usa `APP_BASE_URL`.
- **Los datos viven en volúmenes con nombre** (`pgdata`, `uploads`) para poder moverlos de
  una máquina a otra con un `.tar.gz`.
- **Los avisos hacia fuera van firmados y no bloquean.** Un webhook es un POST con firma
  HMAC-SHA256 y se lanza después de responder: si n8n está caído, guardar una tarea sigue
  funcionando (y el fallo queda apuntado en el propio webhook).
- **El contenedor llega a la máquina anfitriona en `host.docker.internal`.** Compose lo publica
  como `host-gateway`, así que un webhook puede apuntar a algo que corras fuera de Docker.

---

## Requisitos

- **Docker** con Compose v2 (Docker Desktop u OrbStack en macOS, Docker Engine en Linux).
- Opcional, solo para desarrollo sin contenedores: **Node.js 22+**.

No hace falta Node instalado para desplegar: todo corre dentro de los contenedores.

---

## Instalación

```bash
git clone <url-del-repo> agentdesk
cd agentdesk

cp .env.example .env
# Edita .env: como mínimo APP_BASE_URL y POSTGRES_PASSWORD

docker compose up -d --build
```

La primera vez tarda unos minutos porque compila la imagen. Las migraciones se aplican
automáticamente al arrancar (el `entrypoint` del contenedor las ejecuta antes de levantar
el servidor).

Para ver qué está pasando:

```bash
docker compose logs -f app
```

---

## Variables de entorno

Todas viven en `.env` (nunca se commitea; `.env.example` está documentado y sí se commitea).

| Variable | Por defecto | Descripción |
|---|---|---|
| `APP_BASE_URL` | — | **Obligatoria.** URL tal como la escribe el navegador, p. ej. `http://192.168.1.50:3000`. Se usa para enlaces, cookies y CORS. No debe contener `localhost`. |
| `HOST_BIND` | `0.0.0.0` | Interfaz del host donde se publica el puerto. `0.0.0.0` = toda la LAN. |
| `APP_PORT` | `3000` | Puerto del host. El contenedor escucha siempre en `3000`. |
| `POSTGRES_USER` | `agentdesk` | Usuario de Postgres. |
| `POSTGRES_PASSWORD` | — | **Obligatoria.** Usa solo caracteres seguros para URL: `A-Z a-z 0-9 . _ ~ -`. |
| `POSTGRES_DB` | `agentdesk` | Nombre de la base de datos. |
| `DATABASE_URL` | — | Conexión usada por la app. Compose la construye a partir de `POSTGRES_*` con host `db`. |
| `UPLOADS_DIR` | `/app/uploads` | Directorio de artefactos dentro del contenedor (volumen `uploads`). |

### Sobre `APP_BASE_URL`

Es la variable que más problemas causa si se pone mal:

- Si empieza por `https://`, la cookie de sesión se marca `Secure`. Si empieza por `http://`,
  no. Si declaras `https://` pero sirves por `http://`, el navegador descartará la cookie y
  parecerá que el login no funciona.
- Se usa para construir enlaces absolutos y como origen permitido en CORS.
- **Nunca `localhost`**: desde otro dispositivo de la LAN, `localhost` apunta a ese
  dispositivo, no al servidor.

Si tu IP cambia, actualiza `APP_BASE_URL` y reinicia: `docker compose up -d`.

---

## Cómo crear el primer usuario

La aplicación arranca **sin usuarios**. La primera vez que entres:

1. Abre `APP_BASE_URL` en el navegador.
2. Serás redirigido a `/setup`.
3. Elige nombre, email y contraseña. La contraseña debe tener **al menos 12 caracteres**.
4. Al crearse el primer usuario, `/setup` queda deshabilitado para siempre (devuelve `409`).

Después, `/login` es la puerta de entrada habitual.

### Cómo funciona la sesión

- La contraseña se guarda como hash **Argon2id** (19 MiB, 2 iteraciones, 1 lane).
- El login crea una fila en `sessions` y emite la cookie `ad_session`:
  `httpOnly`, `sameSite=lax`, `Secure` **solo** si `APP_BASE_URL` empieza por `https://`.
- En la base de datos solo se guarda `sha256(token)`: un volcado de la base de datos no
  permite suplantar una sesión.
- Caducidad fija de 30 días. No hay renovación deslizante.
- Cerrar sesión borra la fila y la cookie, así que el logout es real (no basta con
  borrar la cookie en el cliente).

### Si olvidas la contraseña

No hay recuperación por email (no hay SMTP). Se cambia desde la máquina donde corre
Docker:

```bash
./scripts/reset-password.sh nuevo@email.com 'la-contraseña-nueva'
```

---

## Comprobar que funciona

```bash
./scripts/verify.sh
```

El script lee `APP_BASE_URL` de `.env`, consulta `/api/health` y comprueba que la raíz
renderiza. Salida esperada:

```
→ APP_BASE_URL = http://192.168.1.177:3000
→ GET http://192.168.1.177:3000/api/health
  {"status":"ok","services":{"app":"ok","db":"ok"},...}
✓ Instalación operativa en http://192.168.1.177:3000
```

La prueba de verdad es abrir `APP_BASE_URL` **desde otro dispositivo de la LAN** (el móvil,
otro portátil). Si eso funciona, `HOST_BIND` y el firewall están bien.

También puedes comprobar el healthcheck de Docker:

```bash
docker compose ps          # la columna STATUS debe decir (healthy) en ambos servicios
```

Y con el smoke test, que recorre la API de verdad:

```bash
SMOKE_EMAIL=tucorreo@example.com SMOKE_PASSWORD='tu-contraseña' ./scripts/smoke.sh
```

Comprueba autenticación, alta de proyecto, etiqueta y tarea, subtareas, cambios de estado,
captura rápida, recurrencias, notas y enlaces, agentes con su token, la API `/api/v1` completa
(tareas, comentarios, cola, delegaciones, runs, logs, artefactos y SSE), el aislamiento entre
agentes, la revocación de tokens y, con un receptor de verdad escuchando, la cadena entera de los
webhooks: evento, cabeceras, firma HMAC, endpoint caído, prueba manual y rotación del secreto.
También levanta el servidor MCP y le pide la cola. No deja datos en la base de datos.

El receptor se abre en la máquina anfitriona y el contenedor llega a él por
`host.docker.internal` (compose lo publica como `host-gateway`). Si el puerto 4599 está ocupado,
`SMOKE_WEBHOOK_PORT=4699 ./scripts/smoke.sh`.

---

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
| `GET` `PATCH` `DELETE` | `/api/tasks/:id` | Leer (con subtareas), editar o borrar |
| `GET` `POST` | `/api/labels` | Listar / crear etiquetas (idempotente por nombre) |
| `DELETE` | `/api/labels/:id` | Borrar una etiqueta |
| `POST` | `/api/capture` | Una línea de lenguaje natural → una tarea |
| `GET` | `/api/search?q=` | Tareas y proyectos para la paleta (mínimo 2 caracteres) |
| `GET` `POST` | `/api/notes` | Listar / crear notas (`?q=` y `?projectId=` para filtrar) |
| `GET` `PATCH` `DELETE` | `/api/notes/:id` | Nota con sus backlinks y enlaces salientes |
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
| `GET` `POST` | `/api/webhooks` | Listar / crear salidas (`POST` devuelve el secreto una vez) |
| `GET` `PATCH` `DELETE` | `/api/webhooks/:id` | Leer, editar (`rotateSecret`), borrar |
| `POST` | `/api/webhooks/:id/test` | Entrega un evento `test` y devuelve la respuesta del receptor |
| `GET` | `/api/openapi.json` | Especificación OpenAPI 3.1 de la API de agentes (pública) |

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

Ejemplo completo:

```bash
curl -s -b cookies.txt 'http://192.168.1.50:3000/api/tasks?status=todo&order=dueDate' | jq
```

Los valores mal formados se descartan en lugar de devolver `422`: un enlace guardado
antiguo debe seguir mostrando algo útil.

---

## Captura rápida

Una línea de texto se convierte en una tarea. Todo es opcional y el orden da igual; lo que no
se entiende **se queda en el título**, nunca se descarta en silencio.

```
revisar CVEs mañana 10:00 p1 #wazuh @seguridad !urgente
```

| Escribes | Se interpreta |
|---|---|
| `hoy`, `mañana`, `pasado mañana` | Fecha |
| `el viernes`, `lunes` | Próximo día de la semana (si hoy es lunes, «lunes» es el de la semana siguiente) |
| `15/02`, `15/02/2027` | Día/mes(/año). Sin año, si ya pasó se entiende del año siguiente |
| `15 de marzo` | Día y mes con nombre |
| `el 20` | Ese día de este mes, o del siguiente si ya pasó |
| `2026-03-01` | Fecha ISO |
| `en 3 días`, `en 2 semanas`, `en un mes` | Desplazamiento relativo |
| `10:00`, `a las 9`, `10h30` | Hora |
| `p1` `p2` `p3` `p4` | Prioridad urgente / alta / normal / baja |
| `!urgente`, `prioridad alta` | Lo mismo, escrito |
| `#wazuh` | Proyecto **existente** (por nombre o identificador, sin distinguir mayúsculas) |
| `@seguridad` | Etiqueta; se crea si no existe |
| `todos los días`, `cada lunes`, `cada lunes y jueves`, `cada 3 días`, `cada mes` | Repetición |

El proyecto se busca, no se inventa: si `#wazuh` no existe, la tarea se guarda sin proyecto y
la respuesta incluye un aviso en `notes`. Las etiquetas sí se crean sobre la marcha, porque son
planas y baratas; un proyecto es un contenedor que se cura a mano.

La caja muestra en vivo lo que ha entendido antes de guardar la tarea.

```bash
curl -s -b cookies.txt -X POST http://192.168.1.50:3000/api/capture \
  -H 'Content-Type: application/json' \
  -d '{"text":"revisar CVEs mañana 10:00 p1 #wazuh @seguridad"}' | jq
```

### Cómo se comportan las repeticiones

Una tarea recurrente **no se cierra**: al completarla avanza a su siguiente fecha y sigue
abierta, como en Todoist. Así una tarea diaria no genera una fila nueva cada día. El registro de
cada ronda completada queda en la actividad (`task.recurred`, con la fecha de origen y la de
destino).

Si escribes una repetición sin fecha, se ancla a su primera ocurrencia: `cada lunes` capturado
en jueves vence el lunes siguiente.

---

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `Ctrl`/`⌘` + `K` | Paleta de comandos |
| `C` | Captura rápida desde cualquier pantalla |
| `?` | Ayuda de atajos |
| `G` y después `I` `H` `U` `T` `P` `N` `A` `B` `R` `S` | Ir a Inbox, Hoy, Próximas, Tareas, Proyectos, Notas, Actividad, Agentes, Runs, Ajustes |

Los atajos de una sola letra se ignoran mientras escribes en un campo de texto, así que nunca
te llevan a otra página a mitad de una frase.

La paleta (`⌘K`) hace tres cosas: busca tareas y proyectos en el servidor, navega y ejecuta
acciones (tema, cerrar sesión, ayuda). Si en lugar de buscar escribes una frase y pulsas Intro,
crea la tarea con la misma gramática de la captura rápida.

---

## Notas

Markdown con enlaces entre notas, al estilo Obsidian. El **título es la identidad** de la nota:
es lo que apuntan los `[[enlaces]]`, y por eso no puede repetirse (crear una nota con un título
ya usado devuelve `409`).

```markdown
# Gestión de incidencias

Ver también [[Procedimiento de guardia]] y el runbook de `wazuh`.

- [x] Revisar alertas
- [ ] Documentar el escalado
```

| Escribes | Se renderiza |
|---|---|
| `# … ######` | Encabezados |
| `**negrita**`, `*cursiva*`, `~~tachado~~` | Énfasis |
| `` `código` `` y bloques con ``` ``` ``` | Código |
| `- item`, `1. item`, `- [x] hecho` | Listas y casillas |
| `> cita`, `---` | Cita y separador |
| `[texto](url)`, `![alt](imagen)` | Enlaces externos e imágenes |
| `[[Otra nota]]`, `[[Otra nota\|ver]]`, `[[Otra nota#Parte]]` | Enlace interno |

El Markdown se convierte a un árbol de nodos que se pinta como elementos de React. **No hay
`dangerouslySetInnerHTML` en ninguna parte**: una nota no puede inyectar HTML, y el subconjunto
admitido es el que se usa de verdad.

### Enlaces y backlinks

- El panel de la nota muestra **«Enlaza con»** (los `[[enlaces]]` de esta nota), **«Mencionada en»**
  (las notas que apuntan aquí) y **«En el mismo proyecto»**.
- Un enlace que todavía no tiene destino se pinta punteado y, al pulsarlo, crea la nota.
- Al **renombrar** una nota se reconstruye el grafo entero de enlaces: lo que apuntaba al título
  viejo deja de resolver, y lo que ya usaba el título nuevo empieza a resolver.
- Al **guardar** una nota solo se recalculan sus enlaces, no los de todo el vault.
- Al **crear** una nota sí se recalcula todo: puede ser justo el título al que otra nota llevaba
  apuntando sin destino.

### Importar y exportar

- **Exportar** descarga `agentdesk-notas-<fecha>.zip` con un `.md` por nota, con frontmatter
  (`title`, `tags`, `created`, `updated`). Descomprímelo en una carpeta y abre esa carpeta con
  Obsidian: funciona tal cual.
- **Importar** acepta varios `.md` a la vez (o todo el contenido de una carpeta). El título sale
  del frontmatter, del nombre del fichero o del primer encabezado, por ese orden. Las claves de
  frontmatter que no se usan se conservan.
- Nada se borra nunca: si el título ya existe, la nota se **omite** y se cuenta como tal, salvo
  que marques «sobrescribir». Reimportar tu propia exportación no duplica nada.

```bash
# Exportar el vault
curl -s -b cookies.txt http://192.168.1.50:3000/api/notes/export -o vault.zip

# Importar dos ficheros
curl -s -b cookies.txt -X POST http://192.168.1.50:3000/api/notes/import \
  -H 'Content-Type: application/json' \
  -d '{"files":[{"name":"a.md","content":"# Nota A"},{"name":"b.md","content":"# Nota B"}],"overwrite":false}' | jq
```

El ZIP se escribe a mano (`lib/zip.ts`, método *store*, sin compresión) porque Node no trae
ninguna biblioteca de ZIP y no merecía la pena añadir una dependencia para unos cientos de
ficheros de texto. La importación, en cambio, no abre archivos: el navegador lee los `.md` y los
envía como JSON, así que el servidor no tiene que descomprimir nada.

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
| `GET` `PATCH` | `/api/v1/notes/:id` | `notes:read` / `notes:write` |
| `GET` `POST` | `/api/v1/delegations` | `delegations:read` / `delegations:write` |
| `GET` `PATCH` | `/api/v1/delegations/:id` | `delegations:read` / `delegations:write` |
| `GET` `POST` | `/api/v1/runs` | `runs:read` / `runs:write` |
| `GET` `PATCH` | `/api/v1/runs/:id` | `runs:read` / `runs:write` |
| `GET` `POST` | `/api/v1/runs/:id/logs` | `runs:read` / `runs:write` |
| `GET` `POST` | `/api/v1/runs/:id/artifacts` | `runs:read` / `runs:write` |
| `GET` | `/api/v1/events` | — (token válido) |

Los filtros de `/api/v1/tasks` son los mismos que los de `/api/tasks`. Los `id` de agente, tarea,
run y delegación son siempre UUID: un id mal formado devuelve `404`, no un error de base de datos.

---

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

---

## Copias de seguridad y migración

### Copia de seguridad

```bash
./scripts/backup.sh
# Copiando AgentDesk (2026-01-31-2200)
#   volcando Postgres…
#   empaquetando el volumen 'uploads'…
# Listo: ./backups/agentdesk-2026-01-31-2200.tar.gz (44K)
```

El `.tar.gz` lleva tres ficheros:

| Fichero | Qué es |
|---|---|
| `meta.txt` | fecha, `APP_BASE_URL`, versión de Postgres (informativo) |
| `db.sql` | volcado SQL plano de la base de datos |
| `uploads.tar` | el volumen de artefactos, tal cual |

Se usa **SQL plano y no formato binario** a propósito: se puede abrir, revisar y restaurar en
cualquier Postgres igual o posterior —el de Proxmox, por ejemplo— sin depender de `pg_restore`.

**Lo que no entra en la copia es el `.env`.** No se puede: es lo que define la contraseña de
Postgres. Guárdalo aparte (en un gestor de contraseñas), porque sin él la restauración no arranca.

Para que se haga sola, en el Mac mini un `launchd` o `cron` con `./scripts/backup.sh` es
suficiente:

```
0 3 * * * cd /ruta/a/agent-os && ./scripts/backup.sh >> backups/backup.log 2>&1
```

### Restauración

```bash
./scripts/restore.sh backups/agentdesk-2026-01-31-2200.tar.gz
```

Es **destructivo**, así que antes de tocar nada hace él mismo una copia del estado actual en
`backups/pre-restore-….tar.gz` y pide confirmación por teclado (`FORCE=1` para saltarla). Después:
para la app, recrea la base de datos, carga `db.sql`, arranca la app y vacía el volumen `uploads`
para descomprimir el de la copia. Al final espera a que el healthcheck diga `healthy`.

### Migración del Mac mini a Proxmox

Los dos pasos que importan son «copiar» y «restaurar»; el resto es preparar la máquina. El
escenario es una **VM**, no un LXC: Docker dentro de un contenedor de Proxmox funciona, pero exige
`nesting` y da problemas sutiles con el almacenamiento. Una VM cuesta 200 MB más y no da ninguno.

**1. En el Mac mini** (`arm64`), con el stack en marcha:

```bash
cd /ruta/a/agent-os
./scripts/backup.sh
# Copia también el .env a un sitio seguro: no va dentro del .tar.gz
cat .env
```

**2. En Proxmox** (`amd64`), crea la VM:

- Ubuntu Server 24.04 LTS, 2 vCPU, 2 GB de RAM, 32 GB de disco (holgado: los datos son mínimos).
- Instala con el usuario y la clave SSH que quieras; IP fija en la LAN.
- Dentro de la VM, instala Docker y Compose:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"     # y vuelve a entrar por SSH
docker compose version
```

**3. Lleva los datos.** Desde tu máquina, con el repositorio y la copia:

```bash
scp scripts/backup.sh scripts/restore.sh usuario@proxmox:/tmp/    # o clona el repo
scp .env usuario@proxmox:/ruta/a/agent-os/.env
scp backups/agentdesk-2026-01-31-2200.tar.gz usuario@proxmox:/ruta/a/agent-os/backups/
```

**4. Ajusta lo único que cambia.** En el `.env` de la máquina nueva:

```ini
APP_BASE_URL=http://192.168.1.60:3000    # la IP de la VM, no la del Mac mini
```

El resto (usuario, contraseña y base de datos) se queda igual. La `DATABASE_URL` sigue apuntando a
`db`, que es el nombre del servicio dentro de la red de Docker: no se toca al cambiar de máquina.

**5. Levanta y restaura.**

```bash
cd /ruta/a/agent-os
docker compose up -d --build      # construye en local: el Dockerfile es multi-arquitectura
./scripts/restore.sh backups/agentdesk-2026-01-31-2200.tar.gz
```

**6. Comprueba.** El arranque aplica las migraciones pendientes y el healthcheck tarda lo suyo la
primera vez:

```bash
docker compose ps
docker inspect --format '{{.State.Health.Status}}' agentdesk-app-1
SMOKE_EMAIL=tu@email SMOKE_PASSWORD=tu-contraseña ./scripts/smoke.sh
```

Y entra con el navegador: mismo usuario y misma contraseña que en el Mac mini, porque te has
llevado la tabla `users` en el volcado.

**7. Apaga el Mac mini** (`docker compose down`) para no dejar dos instancias escribiendo, y
actualiza donde hiciera falta la IP nueva: el marcador del navegador, Tailscale (`tailscale ip -4`
en la VM y `tailscale up` con la misma tailnet) y la URL de los webhooks, que apuntan a un host
concreto.

Tres notas de arquitectura que evitan sorpresas:

- **El volcado es SQL, así que la arquitectura da igual.** Un `pg_dump` de `arm64` se carga en un
  Postgres `amd64` sin conversión.
- **Las imágenes se construyen en cada máquina.** No hay registro ni compilación cruzada: el mismo
  `Dockerfile` da `linux/arm64` en el Mac y `linux/amd64` en Proxmox.
- **Los volúmenes se crean solos** con `docker compose up`. No hay que preparar nada antes de
  restaurar; lo que sí conviene es que la VM tenga su propio plan de copias, repitiendo
  `./scripts/backup.sh` desde el primer día.

### Datos de ejemplo

Si quieres ver la aplicación con contenido antes de tener el tuyo:

```bash
SEED_EMAIL=tu@email SEED_PASSWORD=tu-contraseña ./scripts/seed.sh
```

Crea dos proyectos (`REF`, `PROX`), cuatro etiquetas, nueve tareas —una vencida, una de hoy, una
recurrente y una delegada a un agente—, tres notas enlazadas con `[[wikilinks]]`, un agente con su
token (que imprime al final y no vuelve a mostrarse), una delegación ya aprobada y un run en marcha
con logs, un artefacto y un comentario. Todo pasa por la API pública, así que son datos válidos por
construcción. Se puede repetir: si encuentra el proyecto de ejemplo, avisa y se planta
(`FORCE=1` para duplicarlo).

---

## Pruebas

```bash
npm test              # Vitest: lógica de dominio y validación (rápido, sin base de datos)
npm run typecheck     # tsc --noEmit, en modo estricto
./scripts/smoke.sh    # Prueba de humo de la API contra una instalación en marcha
```

Las pruebas unitarias no tocan la base de datos: cubren lo que se puede equivocar sin
infraestructura (parseo de fechas locales, filtros de la API, esquemas de validación, la captura
en lenguaje natural, el motor de recurrencias, el parser de Markdown, el frontmatter, los
wikilinks, el escritor de ZIP, las reglas de los tokens de agente —formato, cabecera `Bearer` e
implicación de scopes— y las de los webhooks: emparejamiento de suscripciones, firma HMAC y
rechazo de un cuerpo manipulado, de un secreto equivocado o de una petición repetida).
Todo lo que necesita Postgres se comprueba con `scripts/smoke.sh`, que ejercita la API de punta a
punta contra la instalación en marcha.

`npm test` es un `vitest run`: no se queda en modo vigilancia.

---

## Desarrollo

### Todo dentro de contenedores

Es el flujo que reproduce producción:

```bash
docker compose up -d --build
docker compose logs -f app
```

### Con recarga en caliente en el host

Levanta solo la base de datos y ejecuta Next en tu máquina:

```bash
docker compose up -d db

# DATABASE_URL apuntando al puerto publicado de Postgres.
# Es la única excepción a la regla de "nunca localhost": fuera de Docker no hay
# red de servicios, y solo aplica al desarrollo en tu propia máquina.
export DATABASE_URL="postgresql://agentdesk:<password>@127.0.0.1:5432/agentdesk"
export APP_BASE_URL="http://127.0.0.1:3000"

npm install
npm run dev
```

Comandos útiles:

```bash
npm run typecheck     # tsc --noEmit
npm test              # Vitest
npm run db:generate   # genera una migración a partir de lib/db/schema.ts
npm run db:migrate    # aplica migraciones pendientes
npm run db:reset      # DESTRUCTIVO: borra el esquema y reaplica todo
```

---

## Base de datos y migraciones

- **Postgres 16**, servido por el contenedor `db`.
- **Drizzle ORM** con migraciones versionadas en `drizzle/`. Se commitean siempre.
- El esquema vive en `lib/db/schema.ts` y es la única fuente de verdad.

Flujo al cambiar el modelo de datos:

```bash
# 1. Edita lib/db/schema.ts
# 2. Genera la migración
DATABASE_URL="postgresql://agentdesk:<password>@127.0.0.1:5432/agentdesk" npm run db:generate
# 3. Aplícala (en Docker se aplica sola al reiniciar el contenedor)
docker compose up -d --build
```

`drizzle-kit` solo se usa desde el host. La imagen de producción no lo incluye: el
`entrypoint` ejecuta un runner de migraciones precompilado (`migrate.mjs`).

Tablas creadas por la migración inicial (`drizzle/0000_init.sql`):

| Área | Tablas |
|---|---|
| Identidad | `users`, `sessions` |
| Trabajo | `projects`, `labels`, `tasks`, `task_labels` |
| Notas | `notes`, `note_links` |
| Agentes | `agents`, `delegations`, `runs`, `run_logs`, `artifacts` |
| Conocimiento | `decisions` |
| Credenciales | `api_tokens` |
| Operación | `activity_log`, `saved_views`, `webhooks` |

---

## Estructura del repositorio

```
app/                  Rutas de Next.js (App Router)
  (auth)/             Login y asistente de primer arranque
  (app)/              Zona autenticada: shell con sidebar
    inbox/            Bandeja de entrada + captura rápida
    today/            Vencidas y lo de hoy
    upcoming/         Calendario de mes + día seleccionado
    tasks/            Lista y tablero, con filtros
    projects/         Listado y espacio de trabajo del proyecto
    notes/            Notas y vault
    agents/           Listado de agentes y ficha (tokens, delegaciones, runs)
    runs/             Historial de ejecuciones y detalle en vivo
    activity/         Cronología unificada de humanos y agentes
  api/health/         Healthcheck
  api/auth/           setup, login, logout, me
  api/capture/        Captura rápida en lenguaje natural
  api/search/         Búsqueda para la paleta de comandos
  api/notes/          Notas, importación y exportación del vault
  api/projects/       CRUD de proyectos
  api/tasks/          CRUD de tareas y subtareas
  api/labels/         Etiquetas
  api/agents/         Agentes y sus tokens
  api/tokens/         Revocación de tokens
  api/delegations/    Delegaciones vistas desde el humano
  api/runs/           Runs vistos desde el humano
  api/artifacts/      Descarga de artefactos (sesión o token)
  api/webhooks/       Salidas hacia fuera: CRUD y prueba manual
  api/openapi.json/   Especificación OpenAPI 3.1 de la API de agentes
  api/events/         SSE para la UI
  api/v1/             API de agentes: Bearer, scopes, cola, runs, SSE
components/
  agents/             Listado de agentes, ficha, token y diálogo de delegación
  auth/               Formularios de login y setup
  capture/            Caja de captura con vista previa del análisis
  notes/              Listado, editor, renderizador de Markdown y diálogo de importación
  projects/           Listado, diálogo y espacio de trabajo del proyecto
  runs/               Listado de runs y detalle con logs en vivo
  shell/              Sidebar, topbar, navegación móvil, tema, paleta, atajos y refresco SSE
  tasks/              Lista, tablero, secciones, calendario, panel de detalle, hook
  ui/                 Primitivas estilo shadcn/ui (Radix + Tailwind)
  webhooks/           Sección de Ajustes: alta, eventos, prueba y rotación del secreto
docker/
  entrypoint.sh       Aplica migraciones y arranca el servidor
drizzle/              Migraciones SQL versionadas (se commitean)
lib/
  agent-token.ts      Formato, scopes y cabecera Bearer de los tokens (puro, con tests)
  api/                Helpers HTTP, errores, parseo de filtros
  auth/               Hash de contraseñas (Argon2id), sesiones y tokens de agente
  capture.ts          Parser de lenguaje natural (puro, con tests)
  recurrence.ts       Motor de recurrencias RRULE reducido (puro, con tests)
  db/
    schema.ts         Esquema Drizzle — fuente de verdad del modelo
    client.ts         Pool de Postgres (perezoso)
  domain/             Reglas de negocio: proyectos, tareas, notas, agentes, delegaciones,
                      runs, comentarios, actividad, webhooks y bus de eventos
  realtime.ts         Bus de eventos en proceso para SSE
  openapi.ts          Descripción OpenAPI, construida con APP_BASE_URL
  webhook.ts          Catálogo de eventos y emparejamiento de suscripciones (puro, con tests)
  webhook-signature.ts Firma y verificación HMAC-SHA256 (con tests)
  storage.ts          Artefactos en el volumen "uploads"
  constants.ts        Metadatos de estados y prioridades (seguro en cliente)
  clipboard.ts        Copiar al portapapeles, con alternativa para HTTP plano
  dates.ts            Fechas sin sustos de zona horaria
  events.ts           Señales entre componentes del shell
  notes/              Markdown a nodos, frontmatter y wikilinks (puro, con tests)
  types.ts            Contratos JSON entre servidor y cliente
  zip.ts              Escritor de ZIP mínimo, sin dependencias (puro, con tests)
  env.ts              Validación de variables de entorno con Zod
mcp/
  agentdesk-mcp.mjs   Servidor MCP sin dependencias (JSON-RPC por stdio)
scripts/
  migrate.ts          Runner de migraciones (se empaqueta en la imagen)
  reset-password.ts   Cambio de contraseña sin SMTP (se empaqueta en la imagen)
  reset-password.sh   Envoltorio sobre el contenedor
  reset-db.ts         Reinicio destructivo para desarrollo
  backup.sh           Base de datos + artefactos → backups/agentdesk-….tar.gz
  restore.sh          Restauración destructiva, con copia previa de seguridad
  seed.sh             Datos de ejemplo (proyectos, tareas, notas, agente y run)
  webhook-receiver.mjs Receptor de referencia que verifica la firma
  verify.sh           Comprobación de extremo a extremo
  smoke.sh            Prueba de humo de la API
Dockerfile            Build multi-stage, multi-arquitectura
docker-compose.yml    App + Postgres (el mismo en Mac mini y Proxmox)
```

---

## Licencia

Privado. Sin licencia pública.
