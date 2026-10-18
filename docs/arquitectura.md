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
- **Los listados tienen tope, y el tope está escrito.** Tareas y notas 500, runs y artefactos 200,
  actividad 300. Es un espacio de trabajo personal: por debajo de esos números entra todo
  en una consulta y sobran; por encima, un listado paginado no es lo que resuelve el problema. Se
  prefieren límites explícitos a consultas que crecen con el uso.
- **Los cuerpos grandes no viajan enteros.** El listado de notas manda un extracto de 140
  caracteres en lugar del Markdown completo, y los ficheros se quedan en el volumen `uploads`: la
  lista lleva su tamaño y su URL de descarga, no sus bytes.

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
