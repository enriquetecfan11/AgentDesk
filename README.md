# AgentDesk

Workspace operativo self-hosted para **una persona y sus agentes de IA**.

Combina lo que aportan herramientas distintas —issues con estados y prioridades (Linear),
captura rápida en lenguaje natural (Todoist), notas en markdown enlazables (Notion) y tablero
Kanban (Trello)— y añade lo que ninguna de ellas tiene: **los agentes de IA son ciudadanos de
primera clase**. Pueden tener tareas asignadas, crear tareas, escribir notas y dejar registro de
sus ejecuciones. Todo queda en tu cronología, junto a lo que haces tú.

Corre entero en tu propia máquina. Sin servicios externos, sin cuentas, sin telemetría.

```
navegador ──┐                          ┌── db (Postgres 16)
            ├──▶  app  (Next.js 16)  ──┤
agentes ────┘      :3000               └── uploads (artefactos)
```

---

## Índice

- [Estado del proyecto](#estado-del-proyecto)
- [Empezar](#empezar)
- [Qué incluye](#qué-incluye)
- [Agentes en un minuto](#agentes-en-un-minuto)
- [Documentación](#documentación)
- [Stack](#stack)
- [Scripts](#scripts)
- [Licencia](#licencia)

---

## Estado del proyecto

Las ocho fases están terminadas, verificadas y desplegadas en local: **191 pruebas unitarias,
134 comprobaciones de humo** y el healthcheck en verde.

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Esqueleto: repo, Dockerfile multi-arch, compose, Postgres, migraciones, healthchecks | ✅ |
| 2 | Auth + layout + proyectos + tareas (lista y Kanban) | ✅ |
| 3 | Inbox, Today, Upcoming, captura rápida, recurrencias, paleta de comandos | ✅ |
| 4 | Notas con backlinks e import/export markdown | ✅ |
| 5 | Agentes, tokens, API REST v1, delegaciones, runs, SSE | ✅ |
| 6 | Webhooks, OpenAPI, servidor MCP | ✅ |
| 7 | Backup/restore y guía de migración Mac mini → Proxmox | ✅ |
| 8 | Tests, accesibilidad, rendimiento, README final | ✅ |
| 9 | Flujo con humano en medio: MCP en `/api/mcp`, lease de tareas, aprobaciones, autonomía y runner para cron | ✅ |

---

## Empezar

Solo hace falta **Docker con Compose v2**. Node no hace falta para desplegar: todo corre dentro de
los contenedores.

```bash
git clone <url-del-repo> agentdesk
cd agentdesk

cp .env.example .env
# Edita .env: como mínimo APP_BASE_URL y POSTGRES_PASSWORD

docker compose up -d --build
```

La primera vez tarda unos minutos porque compila la imagen. Las migraciones se aplican solas al
arrancar (el `entrypoint` las ejecuta antes de levantar el servidor).

**La regla que más importa:** `APP_BASE_URL` es la URL *tal como la escribe el navegador*, y nunca
contiene `localhost`. Desde el móvil, `localhost` te apunta al móvil, no al servidor:

```ini
APP_BASE_URL=http://192.168.1.50:3000
POSTGRES_PASSWORD=algo-largo-y-solo-con-caracteres-seguros
```

**El primer usuario** se crea en el navegador: abre `APP_BASE_URL`, te redirige a `/setup`, eliges
nombre, email y contraseña (12 caracteres mínimo) y listo. A partir de ahí, `/login`. Si te olvidas
de la contraseña, desde la máquina donde corre Docker:

```bash
./scripts/reset-password.sh tu@email.com 'la-contraseña-nueva'
```

**Comprobar que responde:**

```bash
./scripts/verify.sh                 # health + que la raíz renderiza
docker compose ps                   # la columna STATUS debe decir (healthy)
```

Y si quieres verlo con contenido en vez de vacío:

```bash
SEED_EMAIL=tu@email SEED_PASSWORD='tu-contraseña' ./scripts/seed.sh
```

Crea dos proyectos, etiquetas, tareas (una vencida, una de hoy, una recurrente y una delegada),
notas enlazadas, un agente con su token y un run en marcha con logs y artefacto. Se puede repetir
sin duplicar nada.

Detalle completo en **[docs/instalacion.md](docs/instalacion.md)**: requisitos, todas las variables
de entorno, cómo funciona la sesión y qué comprueba cada script.

---

## Qué incluye

**La interfaz** es densa y funcional, con la referencia de Linear: barra lateral, barra superior,
`⌘K`/`Ctrl+K` para buscar o ejecutar, atajos de teclado, tema claro/oscuro y uso completo desde el
móvil.

| | |
|---|---|
| **Inbox** | Captura rápida en lenguaje natural: un renglón se convierte en tarea con fecha, prioridad, etiquetas y proyecto |
| **Hoy / Próximas** | Lo vencido y lo de hoy; calendario de mes con el día seleccionado |
| **Tareas** | Lista y tablero Kanban, subtareas, repeticiones, filtros y vistas guardadas |
| **Proyectos** | Estados, color, fecha objetivo y progreso por tareas |
| **Notas** | Markdown con `[[wikilinks]]` y backlinks resueltos en el servidor; import/export compatible con un vault de Obsidian |
| **Agentes** | Ficha propia, token con scopes, cola de trabajo, historial de runs y aprobación o rechazo de delegaciones |
| **Runs** | Detalle en vivo con logs en streaming y artefactos (texto, URL o fichero) |
| **Aprobaciones** | Lo que un agente quiere hacer y no puede hacer solo, con sus argumentos exactos: apruebas, editas los argumentos o rechazas con un motivo que el agente recibe |
| **Actividad** | Una sola cronología con lo que haces tú y lo que hacen los agentes |

**La API** son dos superficies distintas: 44 endpoints para el humano (cookie de sesión) y 15 para
los agentes bajo `/api/v1` (`Authorization: Bearer agt_…`, un token por agente con scopes). Zod
valida todo lo que entra, los tokens se guardan solo como hash y cada acción de un agente queda en
la cronología.

**Las salidas** van hacia donde tú quieras: webhooks firmados con HMAC-SHA256 hacia n8n o
cualquier cosa, `GET /api/openapi.json` con la especificación OpenAPI 3.1 y un servidor MCP sin
dependencias en `POST /api/mcp` con 29 herramientas, para que un modelo use AgentDesk como si
fuera una herramienta más.

**Un agente no decide nada irreversible.** Una tarea entra en el Inbox, el agente la reclama con
un lease —un solo agente a la vez, y solo durante quince minutos— y propone: delegarla en otro
agente, o ejecutarla él. Las dos cosas se quedan en **Aprobaciones** con sus argumentos exactos
hasta que tú decides. Cada tarea lleva su propia autonomía (`suggest_only`,
`do_with_approval`, `autonomous_low_risk`), y lo que sale de AgentDesk pide permiso en las tres.
Falla cerrado: una aprobación caducada cuenta como rechazada, una decisión no se sobrescribe y
ningún agente aprueba lo suyo.

---

## Agentes en un minuto

Un agente es una fila con nombre, descripción y capacidades. Su token se emite una vez y se enseña
una sola vez:

```bash
# 1. Crea el agente (con la cookie de sesión del humano)
curl -c jar -X POST "$APP_BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"tu@email.com","password":"tu-contraseña"}'

curl -b jar -X POST "$APP_BASE_URL/api/agents" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Investigador","capabilities":["buscar en la web","resumir"]}'

# 2. Emite un token. El campo "secret" no se vuelve a mostrar.
curl -b jar -X POST "$APP_BASE_URL/api/agents/<id>/tokens" \
  -H 'Content-Type: application/json' \
  -d '{"name":"principal","scopes":["tasks:read","runs:write"]}'
```

A partir de ahí, el agente habla solo con su token. Lo primero es preguntar qué tiene pendiente:

```bash
TOKEN=agt_...

curl -H "Authorization: Bearer $TOKEN" "$APP_BASE_URL/api/v1/queue"
curl -H "Authorization: Bearer $TOKEN" "$APP_BASE_URL/api/v1/events"   # SSE
```

Detalle completo en **[docs/api.md](docs/api.md)**: los 15 endpoints de la API v1, los scopes, el
ciclo de una delegación paso a paso, los runs con logs y artefactos, y SSE para ambos lados.

---

## Documentación

El README es la puerta de entrada; el detalle está repartido en `docs/`:

| Documento | Qué encontrarás |
|---|---|
| **[docs/instalacion.md](docs/instalacion.md)** | Requisitos, instalación, variables de entorno, primer usuario, sesión, contraseña olvidada y cómo verificar |
| **[docs/uso.md](docs/uso.md)** | Captura rápida, atajos de teclado y notas: wikilinks, backlinks e import/export de un vault |
| **[docs/api.md](docs/api.md)** | Los 42 endpoints humanos y la API v1 completa para agentes, con ejemplos `curl` |
| **[docs/integraciones.md](docs/integraciones.md)** | Webhooks firmados, especificación OpenAPI y servidor MCP |
| **[docs/operacion.md](docs/operacion.md)** | Copias de seguridad, restauración, datos de ejemplo, migraciones y la guía de migración a Proxmox |
| **[docs/arquitectura.md](docs/arquitectura.md)** | Diagrama, decisiones de diseño, accesibilidad, rendimiento y estructura del repositorio |
| **[docs/desarrollo.md](docs/desarrollo.md)** | Pruebas, desarrollo con recarga en caliente y trabajo con el esquema |

---

## Stack

| | |
|---|---|
| **App** | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript estricto |
| **Interfaz** | Tailwind CSS 3.4 y 15 primitivas propias estilo shadcn/ui —densa, sin gradientes decorativos |
| **Datos** | Postgres 16 + Drizzle ORM con migraciones SQL versionadas (18 tablas) |
| **Auth** | Propia: email y contraseña con Argon2id, cookie `httpOnly` y sesiones de 30 días |
| **Tiempo real** | SSE en proceso para tareas, runs y cronología |
| **Validación** | Zod en todos los endpoints |
| **Pruebas** | Vitest (191) y una prueba de humo de 134 comprobaciones contra la instalación real |

El mismo `docker-compose.yml` y el mismo Dockerfile sirven en un Mac mini (arm64) y en una VM de
Proxmox (amd64): las imágenes se construyen en local, así que no hay registry ni compilación
cruzada. La única variable que cambia al migrar es `APP_BASE_URL`.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `docker compose up -d --build` | Levanta todo; las migraciones se aplican solas |
| `./scripts/verify.sh` | Comprueba que la instalación responde |
| `./scripts/smoke.sh` | Prueba de humo: 134 comprobaciones de la API de punta a punta |
| `./scripts/seed.sh` | Datos de ejemplo, por la API pública |
| `./scripts/backup.sh` | Postgres + artefactos → `backups/agentdesk-….tar.gz` |
| `./scripts/restore.sh <fichero>` | Restaura una copia (destructivo, con copia previa de seguridad) |
| `./scripts/reset-password.sh <email> <contraseña>` | Cambia una contraseña sin SMTP |
| `./scripts/webhook-receiver.mjs` | Receptor de referencia que verifica la firma HMAC |
| `npm test` · `npm run typecheck` | Pruebas unitarias y comprobación de tipos |

---

## Licencia

Uso privado. No hay licencia pública: el código es tuyo y para tu máquina.
