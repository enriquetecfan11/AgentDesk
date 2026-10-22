# Uso diario

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
| `G` y después `I` `H` `U` `T` `P` `N` `V` `B` `R` `A` `S` | Ir a Inbox, Hoy, Próximas, Tareas, Proyectos, Notas, Aprobaciones, Agentes, Runs, Actividad, Ajustes |

Los atajos de una sola letra se ignoran mientras escribes en un campo de texto, así que nunca
te llevan a otra página a mitad de una frase.

La paleta (`⌘K`) hace tres cosas: busca tareas y proyectos en el servidor, navega y ejecuta
acciones (tema, cerrar sesión, ayuda). Si en lugar de buscar escribes una frase y pulsas Intro,
crea la tarea con la misma gramática de la captura rápida.

---

## Trabajar con un agente

El circuito es siempre el mismo: **una tarea entra en el Inbox, un agente la revisa, y propone
hacerla él o pasársela a otro. Nada con consecuencias pasa sin que tú lo apruebes.**

1. **Creas la tarea** como cualquier otra, con la captura rápida o a mano.
2. **Se activa**, a mano (le dices a un agente que la revise) o por cron, con
   `scripts/task-runner.mjs`.
3. **El agente la reclama.** Queda reservada para él durante quince minutos: solo un agente a la
   vez trabaja una tarea. En el panel de detalle ves quién la tiene y cuánto le queda.
4. **Propone.** Si cree que le toca a otro, propone delegarla; si cree que puede hacerla él, pide
   permiso para ejecutar. En los dos casos **no hace nada todavía**: aparece en **Aprobaciones**.
5. **Tú decides**, y hasta entonces no pasa nada.

### La autonomía de una tarea

Cada tarea decide cuánto puede hacer el agente sin preguntar. Se cambia en su panel de detalle:

| Autonomía | Qué permite |
|---|---|
| **Solo propone** | Leer, comentar y proponer. Cualquier cambio pasa por ti, incluso tomar la tarea |
| **Trabaja y pide permiso** (por defecto) | Avanza la tarea; delegar, ejecutar, enviar o borrar espera tu visto bueno |
| **Autónomo en lo de bajo riesgo** | También parte la tarea en subtareas sin avisar |

Lo que sale de AgentDesk —delegar, ejecutar, enviar, borrar— **pide permiso siempre**, en las
tres. Esa columna decide cuánto papeleo quieres, no si cedes esa autoridad.

### La bandeja de Aprobaciones

Se abre con `G` `V` o desde la barra lateral, que lleva el número de lo que está esperando.
Cada entrada enseña **los argumentos exactos** que te está pidiendo el agente, tal cual, sin
resumir: lo que apruebas es eso.

Puedes **aprobar**, **aprobar cambiando los argumentos** (el agente usará los tuyos, y los suyos
se conservan al lado) o **rechazar con un motivo**, que es obligatorio porque el agente lo recibe
y actúa con él. El campo de motivo sirve también para responderle a una pregunta.

Cuatro cosas que conviene saber:

- **AgentDesk no ejecuta lo que apruebas.** Aprobar «ejecuta este comando» le dice al agente que
  ya puede ejecutarlo él. Lo único que hace AgentDesk por su cuenta es lo que es suyo de
  principio a fin: aprobar una propuesta de delegación crea la delegación de verdad.
- **Una aprobación caduca a las 24 horas, y caducar cuenta como rechazar.** Si prefieres no
  decidir, no decidir es decir no.
- **Una decisión no se cambia.** Una vez aprobada o rechazada, se queda; volver a decidirla da un
  error. Lo que sí puedes es hablarlo con el agente comentando en la tarea.
- **Un agente no aprueba lo suyo.** No hay forma de que lo haga: la decisión solo se puede tomar
  desde la web, con tu sesión.

### Cuando un agente se cuelga

La reserva caduca. Pasados quince minutos sin señales, la tarea **vuelve a «Por hacer»** y la
puede coger otro —y queda apuntado en **Actividad**, así que se ve que pasó. Si una tarea va y
viene de la cola, el contador de veces que se ha tomado (en su panel de detalle) lo delata.

Todo lo que hace un agente queda en **Actividad**, con el filtro Personas / Agentes: lo que
tomó, lo que hizo con aviso, lo que pidió y lo que le dijiste.

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

### Notas escritas por agentes

Una nota recuerda quién la creó (`authorType`, `authorId`, `authorName`) y la lista lo muestra con
un icono cuando el autor es un agente. El filtro **Todas / Mías / Agentes** separa lo que has
escrito tú de lo que han escrito ellos. La autoría es de quien la creó: si un agente añade
contenido a una nota tuya, el cambio queda en la actividad pero la nota sigue siendo tuya.

Los agentes pueden escribir sin conocer el `id` de la nota (`$BASE` y `$AD_TOKEN` como en la guía
de [Integraciones](integraciones.md)):

```bash
# Añadir una entrada al diario, creándolo si no existe
curl -s -X POST "$BASE/api/v1/notes/append" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Diario 2026-10-21","contentMd":"## 10:02\nDesplegado el runner."}'

# Crear o reemplazar por título
curl -s -X PUT "$BASE/api/v1/notes/by-title" \
  -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Estado del despliegue","contentMd":"# Estado\n\nTodo en verde."}'
```

`append` es atómico por nota: dos agentes pueden añadir a la vez sin pisarse. Si el cuerpo
resultante supera los 200 000 caracteres, la petición entera se rechaza con `422` y la nota queda
como estaba.

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
