#!/usr/bin/env node
/**
 * Servidor MCP de AgentDesk.
 *
 * Expone la API `/api/v1` como herramientas para cualquier cliente que hable
 * Model Context Protocol (Claude Desktop, Claude Code, Continue, un agente
 * propio…), hablando JSON-RPC 2.0 por stdin/stdout.
 *
 * Sin dependencias: se copia este fichero a la máquina del agente y se ejecuta
 * con `node agentdesk-mcp.mjs`. Todo el estado vive en AgentDesk; aquí solo hay
 * una traducción de herramientas a llamadas HTTP.
 *
 *   AGENTDESK_URL   http://192.168.1.50:3000     (sin barra final)
 *   AGENTDESK_TOKEN agt_…                        (token del agente)
 *
 * Ejemplo de configuración (Claude Desktop, claude_desktop_config.json):
 *
 *   {
 *     "mcpServers": {
 *       "agentdesk": {
 *         "command": "node",
 *         "args": ["/ruta/a/agentdesk-mcp.mjs"],
 *         "env": {
 *           "AGENTDESK_URL": "http://192.168.1.50:3000",
 *           "AGENTDESK_TOKEN": "agt_…"
 *         }
 *       }
 *     }
 *   }
 *
 * Los logs van a stderr: stdout es el canal del protocolo y cualquier línea que
 * no sea JSON-RPC lo rompe.
 */
import { createInterface } from 'node:readline';

const SERVER_NAME = 'agentdesk';
const SERVER_VERSION = '1.0.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2025-06-18';

const BASE_URL = (process.env.AGENTDESK_URL ?? '').replace(/\/+$/, '');
const TOKEN = process.env.AGENTDESK_TOKEN ?? '';

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

async function call(method, path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text.length > 0 ? safeJson(text) : null;

  if (!response.ok) {
    const detail = parsed && typeof parsed === 'object' && parsed.error ? parsed.error : text;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  return parsed ?? { ok: true };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Serializa los filtros definidos y omite los que no vienen. */
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

const stringProp = (description) => ({ type: 'string', description });

const TOOLS = [
  {
    name: 'whoami',
    description:
      'Devuelve el agente autenticado, sus scopes y sus contadores. Útil para comprobar que el token está bien montado.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => call('GET', '/api/v1/me'),
  },
  {
    name: 'get_queue',
    description:
      'Lo que tienes pendiente: delegaciones accionables y tareas asignadas. Es lo primero que conviene mirar.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => call('GET', '/api/v1/queue'),
  },
  {
    name: 'list_tasks',
    description: 'Lista tareas con filtros.',
    inputSchema: {
      type: 'object',
      properties: {
        status: stringProp('backlog | todo | in_progress | review | done | cancelled'),
        priority: stringProp('none | low | normal | high | urgent'),
        projectId: stringProp('UUID del proyecto'),
        assigneeType: stringProp('human | agent'),
        assigneeId: stringProp('UUID del responsable'),
        dueBefore: stringProp('Fecha límite en formato AAAA-MM-DD'),
        search: stringProp('Texto a buscar en el título'),
      },
      additionalProperties: false,
    },
    run: (args) => call('GET', `/api/v1/tasks${query(args)}`),
  },
  {
    name: 'get_task',
    description: 'Una tarea con sus subtareas.',
    inputSchema: {
      type: 'object',
      properties: { id: stringProp('UUID de la tarea') },
      required: ['id'],
      additionalProperties: false,
    },
    run: (args) => call('GET', `/api/v1/tasks/${args.id}`),
  },
  {
    name: 'create_task',
    description:
      'Crea una tarea. Si no indicas responsable, queda asignada a ti, que es lo que la hace aparecer en tu cola.',
    inputSchema: {
      type: 'object',
      properties: {
        title: stringProp('Título'),
        description: stringProp('Descripción en Markdown'),
        status: stringProp('backlog | todo | in_progress | review | done | cancelled'),
        priority: stringProp('none | low | normal | high | urgent'),
        projectId: stringProp('UUID del proyecto'),
        parentTaskId: stringProp('UUID de la tarea padre'),
        assigneeType: stringProp('human | agent'),
        assigneeId: stringProp('UUID del responsable'),
        dueDate: stringProp('AAAA-MM-DD'),
        dueTime: stringProp('HH:MM'),
        recurrence: stringProp('Regla tipo FREQ=WEEKLY;BYDAY=MO'),
        labelIds: { type: 'array', items: { type: 'string' }, description: 'UUIDs de etiquetas' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    run: (args) => call('POST', '/api/v1/tasks', args),
  },
  {
    name: 'update_task',
    description:
      'Modifica una tarea. Completar una recurrente no la cierra: la adelanta a su siguiente ocurrencia y la respuesta lo indica en recurrenceAdvanced.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID de la tarea'),
        title: stringProp('Título'),
        description: stringProp('Descripción en Markdown'),
        status: stringProp('backlog | todo | in_progress | review | done | cancelled'),
        priority: stringProp('none | low | normal | high | urgent'),
        projectId: stringProp('UUID del proyecto'),
        assigneeType: stringProp('human | agent'),
        assigneeId: stringProp('UUID del responsable'),
        dueDate: stringProp('AAAA-MM-DD'),
        dueTime: stringProp('HH:MM'),
        recurrence: stringProp('Regla tipo FREQ=WEEKLY;BYDAY=MO'),
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: ({ id, ...patch }) => call('PATCH', `/api/v1/tasks/${id}`, patch),
  },
  {
    name: 'comment_task',
    description:
      'Escribe un comentario en una tarea. Queda en la cronología y no se puede editar ni borrar: escribe lo que quieras que se lea dentro de un mes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID de la tarea'),
        body: stringProp('Texto del comentario'),
      },
      required: ['id', 'body'],
      additionalProperties: false,
    },
    run: ({ id, body }) => call('POST', `/api/v1/tasks/${id}/comments`, { body }),
  },
  {
    name: 'list_projects',
    description: 'Lista proyectos.',
    inputSchema: {
      type: 'object',
      properties: { includeArchived: { type: 'boolean', description: 'Incluir los archivados' } },
      additionalProperties: false,
    },
    run: ({ includeArchived }) =>
      call('GET', `/api/v1/projects${query({ includeArchived: includeArchived === true ? '1' : '' })}`),
  },
  {
    name: 'list_notes',
    description: 'Lista notas, opcionalmente filtradas por texto o proyecto.',
    inputSchema: {
      type: 'object',
      properties: {
        q: stringProp('Texto a buscar en el título'),
        projectId: stringProp('UUID del proyecto'),
      },
      additionalProperties: false,
    },
    run: (args) => call('GET', `/api/v1/notes${query(args)}`),
  },
  {
    name: 'get_note',
    description: 'Una nota con sus enlaces y backlinks.',
    inputSchema: {
      type: 'object',
      properties: { id: stringProp('UUID de la nota') },
      required: ['id'],
      additionalProperties: false,
    },
    run: ({ id }) => call('GET', `/api/v1/notes/${id}`),
  },
  {
    name: 'create_note',
    description:
      'Crea una nota en Markdown. El título es su identidad: [[enlaces]] y backlinks se resuelven por título.',
    inputSchema: {
      type: 'object',
      properties: {
        title: stringProp('Título (identidad del wikilink)'),
        contentMd: stringProp('Contenido en Markdown'),
        projectId: stringProp('UUID del proyecto'),
        taskId: stringProp('UUID de la tarea'),
      },
      required: ['title'],
      additionalProperties: false,
    },
    run: (args) => call('POST', '/api/v1/notes', args),
  },
  {
    name: 'update_note',
    description: 'Edita el contenido o el título de una nota.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID de la nota'),
        title: stringProp('Título nuevo'),
        contentMd: stringProp('Contenido en Markdown'),
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: ({ id, ...patch }) => call('PATCH', `/api/v1/notes/${id}`, patch),
  },
  {
    name: 'list_delegations',
    description: 'Tus delegaciones, opcionalmente filtradas por estado.',
    inputSchema: {
      type: 'object',
      properties: {
        status: stringProp('pending | accepted | in_progress | completed | failed | rejected | cancelled'),
      },
      additionalProperties: false,
    },
    run: (args) => call('GET', `/api/v1/delegations${query(args)}`),
  },
  {
    name: 'update_delegation',
    description:
      'Acepta, avanza o cierra una delegación. El campo note se añade como comentario en la tarea asociada, que es donde lo va a leer la persona.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID de la delegación'),
        status: stringProp('pending | accepted | in_progress | completed | failed | rejected | cancelled'),
        note: stringProp('Nota opcional que se añade como comentario'),
      },
      required: ['id', 'status'],
      additionalProperties: false,
    },
    run: ({ id, ...patch }) => call('PATCH', `/api/v1/delegations/${id}`, patch),
  },
  {
    name: 'start_run',
    description:
      'Abre una ejecución para dejar constancia del trabajo. Si indicas delegationId, esa delegación pasa a in_progress.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: stringProp('UUID de la tarea'),
        delegationId: stringProp('UUID de la delegación'),
        status: stringProp('queued | running'),
        input: { description: 'JSON libre: lo que has recibido' },
      },
      additionalProperties: false,
    },
    run: (args) => call('POST', '/api/v1/runs', args),
  },
  {
    name: 'log_run',
    description: 'Añade una línea o un lote de líneas al registro de una ejecución.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID del run'),
        message: stringProp('Mensaje de la línea'),
        level: stringProp('debug | info | warn | error'),
        logs: {
          type: 'array',
          description: 'Alternativa a message: un lote de hasta 500 líneas',
          items: {
            type: 'object',
            properties: { message: { type: 'string' }, level: { type: 'string' } },
            required: ['message'],
          },
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    run: ({ id, ...body }) => call('POST', `/api/v1/runs/${id}/logs`, body),
  },
  {
    name: 'finish_run',
    description:
      'Cierra una ejecución con su resultado. Los tiempos los sella el servidor; cerrar el run cierra su delegación.',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID del run'),
        status: stringProp('succeeded | failed | cancelled | running | queued'),
        output: stringProp('Resultado'),
        error: stringProp('Error, si ha fallado'),
        costUsd: { type: 'number', description: 'Coste estimado en dólares' },
      },
      required: ['id', 'status'],
      additionalProperties: false,
    },
    run: ({ id, ...patch }) => call('PATCH', `/api/v1/runs/${id}`, patch),
  },
  {
    name: 'add_artifact',
    description:
      'Adjunta el resultado de una ejecución: texto, una URL o un fichero en base64 (hasta 8 MB).',
    inputSchema: {
      type: 'object',
      properties: {
        id: stringProp('UUID del run'),
        name: stringProp('Nombre, con extensión'),
        kind: stringProp('file | text | url'),
        mimeType: stringProp('Tipo MIME'),
        content: stringProp('Contenido para kind = text o url'),
        contentBase64: stringProp('Contenido en base64 para kind = file'),
        taskId: stringProp('UUID de la tarea, si el artefacto no es de un run'),
      },
      required: ['id', 'name'],
      additionalProperties: false,
    },
    run: ({ id, ...body }) => call('POST', `/api/v1/runs/${id}/artifacts`, body),
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

const TOOL_LIST = TOOLS.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

// ---------------------------------------------------------------------------
// JSON-RPC por stdio
// ---------------------------------------------------------------------------

function send(message) {
  try {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  } catch {
    // El cliente cerró el canal: no hay a quién contestar.
    quietExit();
  }
}

/**
 * Un cliente que cierra stdin (o un `| head`) deja stdout roto. Un servidor de
 * stdio no debe morir con una traza en ese caso: simplemente ya no hay sesión.
 */
function quietExit() {
  process.exit(0);
}

process.stdout.on('error', (error) => {
  if (error?.code === 'EPIPE') quietExit();
  throw error;
});

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

async function handle(message) {
  const { id, method, params } = message ?? {};

  // Notificaciones (sin id): nada que contestar.
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === undefined) return;

  if (id === undefined) return; // cualquier otra notificación

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: [
          'Empieza por get_queue: devuelve las delegaciones accionables y las tareas asignadas.',
          'Cuando trabajes una delegación, ábrela con start_run y ciérrala con finish_run: así',
          'queda el registro de lo que hiciste y la delegación se cierra sola.',
        ].join(' '),
      });
      return;
    }

    case 'ping':
      reply(id, {});
      return;

    case 'tools/list':
      reply(id, { tools: TOOL_LIST });
      return;

    case 'tools/call': {
      const tool = TOOLS_BY_NAME.get(params?.name);
      if (!tool) {
        replyError(id, -32602, `Herramienta desconocida: ${params?.name}`);
        return;
      }

      try {
        const result = await tool.run(params?.arguments ?? {});
        reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (error) {
        // Un fallo de la API no es un fallo del protocolo: se devuelve como
        // contenido para que el modelo lo lea y pueda reaccionar.
        reply(id, {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        });
      }
      return;
    }

    default:
      replyError(id, -32601, `Método no soportado: ${method}`);
  }
}

function main() {
  if (process.argv.includes('--list')) {
    for (const tool of TOOL_LIST) process.stdout.write(`${tool.name}\t${tool.description}\n`);
    return;
  }

  if (process.argv.includes('--help')) {
    process.stdout.write(
      [
        'Servidor MCP de AgentDesk. Habla JSON-RPC por stdin/stdout.',
        '',
        'Variables:',
        '  AGENTDESK_URL    URL base, sin barra final (p. ej. http://192.168.1.50:3000)',
        '  AGENTDESK_TOKEN  Token del agente (agt_…)',
        '',
        'Opciones:',
        '  --list   Imprime las herramientas y sale',
        '  --help   Esto mismo',
        '',
      ].join('\n'),
    );
    return;
  }

  if (!BASE_URL || !TOKEN) {
    process.stderr.write(
      '[agentdesk-mcp] Faltan AGENTDESK_URL o AGENTDESK_TOKEN. Ejecuta con --help para ver la configuración.\n',
    );
    process.exit(1);
  }

  process.stderr.write(`[agentdesk-mcp] ${SERVER_NAME} ${SERVER_VERSION} → ${BASE_URL}\n`);

  const lines = createInterface({ input: process.stdin, terminal: false });

  lines.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      // Sin id no se puede contestar nada útil; se avisa por stderr.
      process.stderr.write('[agentdesk-mcp] mensaje no válido (no es JSON)\n');
      return;
    }

    void handle(message).catch((error) => {
      const id = message?.id;
      if (id === undefined) return;
      replyError(id, -32603, error instanceof Error ? error.message : 'Error interno');
    });
  });
}

main();
