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
| 5 | Agentes, tokens, API REST v1, delegaciones, runs, SSE | ⏳ |
| 6 | Webhooks, OpenAPI, servidor MCP | ⏳ |
| 7 | Backup/restore y guía de migración Mac mini → Proxmox | ⏳ |
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
validación de errores y limpieza. No deja datos en la base de datos.

---

## API HTTP

Todos los endpoints exigen sesión de usuario (cookie `ad_session`) salvo los de autenticación
y `/api/health`. Los agentes usarán tokens Bearer en `/api/v1` (Fase 5).

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

## Pruebas

```bash
npm test              # Vitest: lógica de dominio y validación (rápido, sin base de datos)
npm run typecheck     # tsc --noEmit, en modo estricto
./scripts/smoke.sh    # Prueba de humo de la API contra una instalación en marcha
```

Las pruebas unitarias no tocan la base de datos: cubren lo que se puede equivocar sin
infraestructura (parseo de fechas locales, filtros de la API, esquemas de validación, la captura
en lenguaje natural, el motor de recurrencias, el parser de Markdown, el frontmatter, los
wikilinks y el escritor de ZIP).
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
  api/health/         Healthcheck
  api/auth/           setup, login, logout, me
  api/capture/        Captura rápida en lenguaje natural
  api/search/         Búsqueda para la paleta de comandos
  api/notes/          Notas, importación y exportación del vault
  api/projects/       CRUD de proyectos
  api/tasks/          CRUD de tareas y subtareas
  api/labels/         Etiquetas
components/
  auth/               Formularios de login y setup
  capture/            Caja de captura con vista previa del análisis
  notes/              Listado, editor, renderizador de Markdown y diálogo de importación
  projects/           Listado, diálogo y espacio de trabajo del proyecto
  shell/              Sidebar, topbar, navegación móvil, tema, paleta y atajos
  tasks/              Lista, tablero, secciones, calendario, panel de detalle, hook
  ui/                 Primitivas estilo shadcn/ui (Radix + Tailwind)
docker/
  entrypoint.sh       Aplica migraciones y arranca el servidor
drizzle/              Migraciones SQL versionadas (se commitean)
lib/
  api/                Helpers HTTP, errores, parseo de filtros
  auth/               Hash de contraseñas (Argon2id) y sesiones
  capture.ts          Parser de lenguaje natural (puro, con tests)
  recurrence.ts       Motor de recurrencias RRULE reducido (puro, con tests)
  db/
    schema.ts         Esquema Drizzle — fuente de verdad del modelo
    client.ts         Pool de Postgres (perezoso)
  domain/             Reglas de negocio: proyectos, tareas, etiquetas, captura, actividad
  constants.ts        Metadatos de estados y prioridades (seguro en cliente)
  dates.ts            Fechas sin sustos de zona horaria
  events.ts           Señales entre componentes del shell
  notes/              Markdown a nodos, frontmatter y wikilinks (puro, con tests)
  types.ts            Contratos JSON entre servidor y cliente
  zip.ts              Escritor de ZIP mínimo, sin dependencias (puro, con tests)
  env.ts              Validación de variables de entorno con Zod
scripts/
  migrate.ts          Runner de migraciones (se empaqueta en la imagen)
  reset-password.ts   Cambio de contraseña sin SMTP (se empaqueta en la imagen)
  reset-password.sh   Envoltorio sobre el contenedor
  reset-db.ts         Reinicio destructivo para desarrollo
  verify.sh           Comprobación de extremo a extremo
  smoke.sh            Prueba de humo de la API
Dockerfile            Build multi-stage, multi-arquitectura
docker-compose.yml    App + Postgres (el mismo en Mac mini y Proxmox)
```

---

## Licencia

Privado. Sin licencia pública.
