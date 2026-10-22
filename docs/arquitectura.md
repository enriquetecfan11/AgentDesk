# Arquitectura

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
│        │  · /api/mcp    (MCP, mismo token)      │            │
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
- **El servidor MCP vive dentro de la app, en `/api/mcp`.** Estuvo un rato en un contenedor
  aparte que proxyeaba a `/api/v1`, y eso significaba autenticar dos veces, perder el detalle de
  los errores por el camino y mantener la tabla de herramientas en dos sitios. Dentro de la app,
  una herramienta llama al dominio directamente: un proceso, un puerto y un único catálogo.
  `mcp/agentdesk-mcp.mjs` se queda como puente `stdio` para los clientes que exigen un proceso
  hijo, y no tiene catálogo propio: reenvía el JSON-RPC tal cual.
- **Nada con consecuencias lo decide un agente.** Lo que un agente propone y no puede hacer solo
  queda en la tabla `approvals` con sus argumentos exactos, y lo decide una persona desde la web.
  Las tres reglas duras viven donde no se pueden saltar: el plazo es `NOT NULL` y toda lectura
  barre lo vencido (**falla cerrado**); decidir es un `UPDATE … WHERE status = 'pending'`, así
  que la segunda decisión no encaja con ninguna fila (**no se sobrescribe**); y `decided_by_user_id`
  apunta a `users` sin ninguna ruta de agente que lo escriba (**un agente no aprueba lo suyo**).
- **Una tarea se reserva con un lease, no con un flag.** Reclamarla es un solo `UPDATE`
  condicional con la guarda dentro del `WHERE`, y coger la siguiente es un CTE con
  `for update skip locked`: dos runners simultáneos se llevan tareas distintas en lugar de pelearse
  por una. El plazo es lo que hace recuperable un agente muerto —la tarea vuelve a la cola— y el
  barrido se hace al leer, no desde un planificador, porque un contenedor más para una sentencia
  cada cinco minutos no se sostiene.

---

## Diseño responsive

La adaptación no vive en cada pantalla: un único `AppShell` posee el estado de la barra lateral y
decide cómo se reparte el ancho. Las páginas solo declaran su contenido.

- **Tres estados, una preferencia.** La barra lateral puede estar expandida (`w-60`), colapsada
  (`w-16`, solo iconos con tooltips) u oculta (`w-0`). La elección se guarda en `localStorage`
  (`agentdesk.sidebar`); si no hay ninguna, una tablet (768–1199 px) arranca colapsada y el resto
  expandida. El botón de la cabecera siempre puede recuperarla.
- **Un contenedor que no scrollea en horizontal.** `AppShell` usa `flex h-dvh overflow-hidden`; la
  barra es un hermano flex, así que al plegarse el ancho pasa al contenido sin medir nada, y
  `<main>` es el único scroller vertical (`overflow-x-hidden`). Cualquier scroll horizontal es
  local: el Kanban lo tiene dentro de cada tablero y los bloques de código lo declaran.
- **Móvil sin barra.** Por debajo de `md` la barra desaparece y la navegación se abre en un `Sheet`
  de Radix (overlay, clic fuera y `Escape` incluidos). El botón de menú de la cabecera es la vía de
  vuelta.
- **Filtros que envuelven, no que desbordan.** `PageToolbar`, `ToolbarFilters` y `ToolbarSearch`
  centralizan la barra de filtros: el buscador ocupa la fila en móvil y crece en escritorio, los
  controles hacen `flex-wrap` y los `Select` se limitan al ancho disponible.
- **Diálogos y hojas dentro de la pantalla.** Los `Dialog`/`AlertDialog` usan
  `w-[calc(100vw-2rem)]` y `max-h-[calc(100dvh-2rem)]`; el detalle de tarea es un modal centrado
  de 720 px como máximo, pantalla completa en móvil y con la cabecera fija y el cuerpo scrolleable.
  Edita en sitio y, al cerrar con `Escape`, con la `X` o pulsando fuera, vuelca antes el borrador:
  nunca se pierde lo escrito.
- **Drag & drop también con el dedo.** HTML5 DnD no existe en Android/iOS, así que las tarjetas
  muestran un asa solo para punteros gruesos (`@media (pointer: coarse)`) que arrastra con eventos
  de puntero (`useTouchDrag`); el ratón sigue usando DnD nativo. La tarjeta arrastrada permanece
  montada para no perder la captura del puntero.

## Accesibilidad y rendimiento

La aplicación está hecha para usarse a diario desde el ordenador y, a menudo, desde el móvil. Eso
son dos listas de comprobaciones, no un apartado decorativo.

### Accesibilidad

- **HTML semántico y un solo `h1` por pantalla.** El título de la barra superior es el `h1`; los
  bloques usan `h2`/`h3`, y los formularios etiquetas `label` de verdad, asociadas al campo.
- **Enlace «Saltar al contenido».** Es lo primero que recibe el foco al tabular, así que no hay que
  atravesar las diez entradas de la barra lateral para llegar a la página.
- **Foco siempre visible.** Los componentes que dibujan su propio anillo lo declaran; el resto
  heredan un `outline` de 2 px definido una sola vez en `app/globals.css`. Nunca se apaga el foco
  sin poner algo en su lugar.
- **Diálogos con nombre, aunque no se vea.** Radix exige un título para anunciar el diálogo; la
  paleta de comandos no tiene uno visible, así que lleva un `DialogTitle` con `sr-only`. Igual con
  la navegación móvil, que se anuncia como «Navegación».
- **Estado, no solo color.** La página activa lleva `aria-current="page"`, las prioridades y los
  estados tienen icono y texto alternativo, y los botones que solo son un icono llevan
  `aria-label`.
- **Objetivos táctiles de 44 px en móvil.** Las entradas de la barra lateral, el botón de tema, el
  de cerrar sesión y los dos de la barra superior miden 44 px por debajo de `md` y vuelven a su
  tamaño compacto en escritorio (`min-h-11 md:min-h-9`), que es donde importa la densidad.
- **`prefers-reduced-motion` respetado.** Si el sistema pide menos movimiento, las transiciones se
  reducen a cero. No hay ninguna animación de la que dependa la interfaz, así que no se pierde nada.
- **Teclado de principio a fin.** `⌘K`/`Ctrl+K` abre la paleta, `C` captura, `G` luego la inicial
  navega, `?` enseña los atajos y `Escape` cierra cualquier diálogo.

### Rendimiento

El objetivo no es ganar una carrera de milisegundos, sino que la aplicación no se degrade cuando
haya miles de tareas. Las decisiones que lo sostienen:

- **Contar es una consulta, no una lista.** Ajustes mostraba tres números contando en memoria las
  listas completas de tareas, proyectos y etiquetas; ahora cada número es un `count(*)`. La
  diferencia se nota cuando el listado pasa de unos cientos de filas.
- **Índices para lo que se consulta a diario.** El esquema define índices sobre las claves foráneas
  y sobre las columnas de filtro —`tasks.status`, `tasks.due_date`, `tasks.project_id`,
  `activity_log.created_at`, `runs.status`—, que son las que aparecen en cada carga de pantalla.
- **Un solo canal de eventos.** El shell abre un único `EventSource` (`/api/events`) para todos los
  cambios en vivo, con `router.refresh()` agrupado cada 400 ms. Los `run.log` no viajan por ahí:
  son demasiado ruidosos y llegan por su propia petición al abrir el detalle del run.
- **Sin dependencias de más.** La paleta de componentes se recortó a lo que se usa (quince
  primitivas en total): cada fichero que se borra es una dependencia de Radix menos que instalar y
  analizar en cada `npm ci`.
- **Los listados tienen tope, y el tope está escrito.** La UI carga hasta 500 notas y 500 tareas;
  la API de notas pagina con `limit`/`offset` (100 por defecto, 500 como máximo), y runs y
  artefactos se quedan en 200, actividad en 300. Es un espacio de trabajo personal: por debajo de
  esos números entra todo en una consulta y sobran; por encima, la paginación explícita es más
  honesta que una consulta que crece con el uso.
- **Los cuerpos grandes no viajan enteros.** El listado de notas manda un extracto de 140
  caracteres en lugar del Markdown completo, y los ficheros se quedan en el volumen `uploads`: la
  lista lleva su tamaño y su URL de descarga, no sus bytes.

---

## Estructura del repositorio

```
app/                  Rutas de Next.js (App Router)
  (auth)/             Login y asistente de primer arranque
  (app)/              Zona autenticada: AppShell con barra lateral responsive
    inbox/            Bandeja de entrada + captura rápida
    today/            Vencidas y lo de hoy
    upcoming/         Calendario de mes + día seleccionado
    tasks/            Lista y tablero, con filtros
    board/            Un Kanban por proyecto: responsive y con scroll propio
    projects/         Listado y espacio de trabajo del proyecto
    notes/            Notas y vault
    agents/           Listado de agentes y ficha (tokens, delegaciones, runs)
    runs/             Historial de ejecuciones y detalle en vivo
    approvals/        Bandeja de lo que un agente dejó esperando tu decisión
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
  api/approvals/      Bandeja de aprobaciones y la decisión (solo sesión)
  api/openapi.json/   Especificación OpenAPI 3.1 de la API de agentes
  api/events/         SSE para la UI
  api/mcp/            Servidor MCP: JSON-RPC 2.0 por Streamable HTTP
  api/v1/             API de agentes: Bearer, scopes, cola, runs, SSE
components/
  agents/             Listado de agentes, ficha, token y diálogo de delegación
  approvals/          Bandeja y diálogo de decisión (payload exacto, editable)
  auth/               Formularios de login y setup
  board/              Kanban por proyecto: tarjeta compacta y tablero con drag & drop
  capture/            Caja de captura con vista previa del análisis
  notes/              Listado, editor, renderizador de Markdown y diálogo de importación
  projects/           Listado, diálogo y espacio de trabajo del proyecto
  runs/               Listado de runs y detalle con logs en vivo
  shell/              AppShell (estado de la barra), sidebar, topbar, barra de filtros, tema,
                      paleta, atajos y refresco SSE
  tasks/              Lista, tablero, secciones, calendario, panel de detalle, hook
  ui/                 Primitivas estilo shadcn/ui (Radix + Tailwind)
  webhooks/           Sección de Ajustes: alta, eventos, prueba y rotación del secreto
docker/
  entrypoint.sh       Aplica migraciones y arranca el servidor
drizzle/              Migraciones SQL versionadas (se commitean)
lib/
  agent-token.ts      Formato, scopes y cabecera Bearer de los tokens (puro, con tests)
  agent-flow/
    policy.ts         Riesgo por herramienta × autonomía de la tarea (puro, con tests)
    lease.ts          Plazos de lease y de aprobación; falla cerrado (puro, con tests)
  mcp/
    protocol.ts       Envoltorio JSON-RPC 2.0 y MCP (puro, con tests)
    tools-flow.ts     Las 13 herramientas del flujo con humano en medio
    tools-workspace.ts Las de siempre, intactas; create/update_task sí pasan por el filtro
    index.ts          Catálogo único y despacho
  api/                Helpers HTTP, errores, parseo de filtros
  auth/               Hash de contraseñas (Argon2id), sesiones y tokens de agente
  capture.ts          Parser de lenguaje natural (puro, con tests)
  recurrence.ts       Motor de recurrencias RRULE reducido (puro, con tests)
  db/
    schema.ts         Esquema Drizzle — fuente de verdad del modelo
    client.ts         Pool de Postgres (perezoso)
  domain/             Reglas de negocio: proyectos, tareas, notas, agentes, delegaciones,
                      runs, comentarios, actividad, webhooks y bus de eventos
    claims.ts         Lease de tareas: reclamar, renovar, soltar y barrer lo vencido
    approvals.ts      La puerta: crear, listar, decidir y caducar aprobaciones
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
  agentdesk-mcp.mjs   Puente stdio hacia /api/mcp, sin catálogo propio
scripts/
  migrate.ts          Runner de migraciones (se empaqueta en la imagen)
  reset-password.ts   Cambio de contraseña sin SMTP (se empaqueta en la imagen)
  reset-password.sh   Envoltorio sobre el contenedor
  reset-db.ts         Reinicio destructivo para desarrollo
  backup.sh           Base de datos + artefactos → backups/agentdesk-….tar.gz
  restore.sh          Restauración destructiva, con copia previa de seguridad
  seed.sh             Datos de ejemplo (proyectos, tareas, notas, agente y run)
  webhook-receiver.mjs Receptor de referencia que verifica la firma
  task-runner.mjs     Runner de referencia para cron: una pasada por invocación
  verify.sh           Comprobación de extremo a extremo
  smoke.sh            Prueba de humo de la API
Dockerfile            Build multi-stage, multi-arquitectura
docker-compose.yml    App + Postgres (el mismo en Mac mini y Proxmox)
```
