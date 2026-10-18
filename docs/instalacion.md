# Instalación y puesta en marcha

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
