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
| 2 | Auth + layout + proyectos + tareas (lista y Kanban) | ⏳ |
| 3 | Inbox, Today, Upcoming, captura rápida, recurrencias, paleta de comandos | ⏳ |
| 4 | Notas con backlinks e import/export markdown | ⏳ |
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
3. Elige email y contraseña. La contraseña debe tener **al menos 12 caracteres**.
4. Al crearse el primer usuario, `/setup` queda deshabilitado para siempre (devuelve `409`).

> Esta pantalla se implementa en la **Fase 2**. Hasta entonces, la raíz muestra una página de
> estado con la URL base y la conectividad con la base de datos.

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
  api/health/         Healthcheck
  layout.tsx          Layout raíz (tema claro/oscuro)
components/
  ui/                 Primitivas estilo shadcn/ui (Radix + Tailwind)
docker/
  entrypoint.sh       Aplica migraciones y arranca el servidor
drizzle/              Migraciones SQL versionadas (se commitean)
lib/
  db/
    schema.ts         Esquema Drizzle — fuente de verdad del modelo
    client.ts         Pool de Postgres (perezoso)
  env.ts              Validación de variables de entorno con Zod
scripts/
  migrate.ts          Runner de migraciones (se empaqueta en la imagen)
  reset-db.ts         Reinicio destructivo para desarrollo
  verify.sh           Comprobación de extremo a extremo
Dockerfile            Build multi-stage, multi-arquitectura
docker-compose.yml    App + Postgres (el mismo en Mac mini y Proxmox)
```

---

## Licencia

Privado. Sin licencia pública.
