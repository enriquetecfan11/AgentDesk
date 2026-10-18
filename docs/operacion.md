# Operación

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
