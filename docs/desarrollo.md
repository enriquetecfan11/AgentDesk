# Desarrollo

## Pruebas

```bash
npm test              # Vitest: lógica de dominio y validación (rápido, sin base de datos)
npm run typecheck     # tsc --noEmit, en modo estricto
./scripts/smoke.sh    # Prueba de humo de la API contra una instalación en marcha
```

Ahora mismo: **191 pruebas unitarias en 12 ficheros** y **134 comprobaciones** en la prueba de humo,
todas en verde. Se ejecutan sin red y sin Postgres las primeras, y contra la instalación real las
segundas.

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

## Flujo de trabajo

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
