/** Public OpenAPI document shared by the API documentation and API clients. */
import { z } from 'zod';
import * as validation from '@/lib/validation';
import { humanPaths } from '@/lib/openapi-human';

type Json = Record<string, unknown>;

const errorSchema: Json = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', description: 'Mensaje legible en español.' },
    details: {
      description: 'Detalle del fallo: issues de Zod, o el scope que falta.',
      nullable: true,
    },
  },
};

const agentSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    capabilities: { type: 'array', items: { type: 'string' } },
    status: { type: 'string', enum: ['active', 'paused', 'archived'] },
  },
};

const taskSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: {
      type: 'string',
      enum: ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'],
    },
    priority: { type: 'string', enum: ['none', 'low', 'normal', 'high', 'urgent'] },
    projectId: { type: 'string', format: 'uuid', nullable: true },
    parentTaskId: { type: 'string', format: 'uuid', nullable: true },
    assigneeType: { type: 'string', enum: ['human', 'agent'], nullable: true },
    assigneeId: { type: 'string', format: 'uuid', nullable: true },
    dueDate: { type: 'string', format: 'date', nullable: true },
    dueTime: { type: 'string', nullable: true, description: 'HH:MM' },
    recurrence: { type: 'string', nullable: true, description: 'Fragmento RRULE reducido.' },
    sortOrder: { type: 'number' },
    completedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    project: { nullable: true, type: 'object' },
    labels: { type: 'array', items: { type: 'object' } },
    subtaskTotal: { type: 'integer' },
    subtaskDone: { type: 'integer' },
    autonomy: {
      type: 'string',
      enum: ['suggest_only', 'do_with_approval', 'autonomous_low_risk'],
      description: 'Cuánto puede hacer el agente sin pedir permiso en esta tarea.',
    },
    claimedByAgentId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: 'Agente que tiene el lease, si hay alguno.',
    },
    claimedByAgentName: { type: 'string', nullable: true },
    leaseExpiresAt: { type: 'string', format: 'date-time', nullable: true },
    heartbeatAt: { type: 'string', format: 'date-time', nullable: true },
    claimCount: { type: 'integer', description: 'Veces que se ha reclamado.' },
    leaseSecondsLeft: {
      type: 'integer',
      nullable: true,
      description: 'Segundos que quedan de lease; null si no la tiene nadie.',
    },
  },
};

const approvalSchema: Json = {
  type: 'object',
  description:
    'Una acción que un agente quiere hacer y no puede hacer sola. AgentDesk es la puerta, no el ejecutor: aprobar no ejecuta nada, se lo dice al agente.',
  properties: {
    id: { type: 'string', format: 'uuid' },
    taskId: { type: 'string', format: 'uuid' },
    agentId: { type: 'string', format: 'uuid' },
    runId: { type: 'string', format: 'uuid', nullable: true },
    tool: {
      type: 'string',
      description: 'La herramienta parada: propose_delegation, shell.run, email.send…',
    },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    status: {
      type: 'string',
      enum: ['pending', 'approved', 'rejected', 'expired', 'cancelled'],
    },
    title: { type: 'string' },
    summary: { type: 'string', nullable: true },
    payload: { type: 'object', description: 'Los argumentos exactos del agente.' },
    payloadEdited: {
      type: 'object',
      nullable: true,
      description: 'Los argumentos con los que se aprobó, si una persona los cambió.',
    },
    reason: {
      type: 'string',
      nullable: true,
      description: 'Motivo del rechazo o respuesta. El agente lo recibe.',
    },
    decidedByUserId: { type: 'string', format: 'uuid', nullable: true },
    decidedByUserName: { type: 'string', nullable: true },
    decidedAt: { type: 'string', format: 'date-time', nullable: true },
    expiresAt: { type: 'string', format: 'date-time' },
    secondsLeft: { type: 'integer', nullable: true },
    decision: {
      type: 'string',
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      description:
        'Qué debe hacer el agente. Falla cerrado: una aprobación caducada se informa como "rejected".',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

const projectSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    identifier: { type: 'string', nullable: true },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    status: { type: 'string', enum: ['active', 'paused', 'completed', 'archived'] },
    color: { type: 'string', nullable: true },
    targetDate: { type: 'string', format: 'date', nullable: true },
    milestones: { type: 'array', items: { type: 'object' } },
    archivedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    taskTotal: { type: 'integer' },
    taskDone: { type: 'integer' },
  },
};

const noteSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string', description: 'También es la identidad del wikilink.' },
    contentMd: { type: 'string' },
    source: { type: 'string', enum: ['app', 'obsidian'] },
    authorType: {
      type: 'string',
      enum: ['human', 'agent', 'system'],
      description: 'Quién creó la nota.',
    },
    authorId: { type: 'string', format: 'uuid', nullable: true },
    authorName: { type: 'string', description: 'Nombre desnormalizado, sobrevive al borrado.' },
    projectId: { type: 'string', format: 'uuid', nullable: true },
    taskId: { type: 'string', format: 'uuid', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
};

/** The listing never carries the body: only the 140-character excerpt. */
const noteListItemSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    title: { type: 'string' },
    excerpt: { type: 'string' },
    authorType: { type: 'string', enum: ['human', 'agent', 'system'] },
    authorId: { type: 'string', format: 'uuid', nullable: true },
    authorName: { type: 'string' },
    projectId: { type: 'string', format: 'uuid', nullable: true },
    project: { nullable: true, type: 'object' },
    updatedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    outgoingCount: { type: 'integer' },
    backlinkCount: { type: 'integer' },
  },
};

const delegationSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    fromType: { type: 'string', enum: ['human', 'agent', 'system'] },
    fromId: { type: 'string', format: 'uuid', nullable: true },
    toAgentId: { type: 'string', format: 'uuid' },
    taskId: { type: 'string', format: 'uuid', nullable: true },
    title: { type: 'string' },
    instructions: { type: 'string', nullable: true },
    status: {
      type: 'string',
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'failed', 'rejected', 'cancelled'],
    },
    requiresApproval: { type: 'boolean' },
    approvedAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    agent: { nullable: true, type: 'object' },
    task: { nullable: true, type: 'object' },
  },
};

const runSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    agentId: { type: 'string', format: 'uuid' },
    taskId: { type: 'string', format: 'uuid', nullable: true },
    delegationId: { type: 'string', format: 'uuid', nullable: true },
    status: {
      type: 'string',
      enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
    },
    input: { nullable: true, description: 'JSON libre: lo que el agente recibió.' },
    output: { type: 'string', nullable: true },
    error: { type: 'string', nullable: true },
    startedAt: { type: 'string', format: 'date-time', nullable: true },
    finishedAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'Lo sella el servidor, nunca el agente.',
    },
    durationMs: { type: 'integer', nullable: true },
    costUsd: { type: 'number', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    logCount: { type: 'integer' },
    artifactCount: { type: 'integer' },
  },
};

const runLogSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    runId: { type: 'string', format: 'uuid' },
    level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
    message: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

const artifactSchema: Json = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    runId: { type: 'string', format: 'uuid', nullable: true },
    taskId: { type: 'string', format: 'uuid', nullable: true },
    name: { type: 'string' },
    kind: { type: 'string', enum: ['file', 'text', 'url'] },
    mimeType: { type: 'string', nullable: true },
    sizeBytes: { type: 'integer', nullable: true },
    content: { type: 'string', nullable: true, description: 'Solo para kind = text.' },
    downloadUrl: {
      type: 'string',
      nullable: true,
      description: 'Solo para kind = file.',
    },
    createdAt: { type: 'string', format: 'date-time' },
  },
};

/** `{ <property>: [ <Ref> ] }`, the shape every list endpoint answers with. */
function listOf(property: string, ref: string): Json {
  return {
    type: 'object',
    required: [property],
    properties: {
      [property]: { type: 'array', items: { $ref: `#/components/schemas/${ref}` } },
    },
  };
}

/** `?from=&to=` style filters, described once. */
const taskFilters: Json[] = [
  { name: 'status', in: 'query', schema: { type: 'string' } },
  { name: 'priority', in: 'query', schema: { type: 'string' } },
  { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
  { name: 'assigneeType', in: 'query', schema: { type: 'string', enum: ['human', 'agent'] } },
  { name: 'assigneeId', in: 'query', schema: { type: 'string', format: 'uuid' } },
  { name: 'dueBefore', in: 'query', schema: { type: 'string', format: 'date' } },
  { name: 'search', in: 'query', schema: { type: 'string' } },
];

const jsonBody = (ref: string) => ({
  required: true,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const jsonResponse = (description: string, ref: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});

const errors = {
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
  404: { $ref: '#/components/responses/NotFound' },
  422: { $ref: '#/components/responses/Invalid' },
};

const taskIdParam: Json = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

// Input mode preserves optional defaults and omits output-only transformations.
// Custom refinements remain enforced by the very same Zod schemas in handlers.
export function inputSchema(schema: z.ZodType): Json {
  const { $schema, ...json } = z.toJSONSchema(schema, { io: 'input' });
  return json;
}

export function buildOpenApi(baseUrl: string) {
  const document = {
    openapi: '3.1.0',
    info: {
      title: 'AgentDesk — API',
      version: '1.0.0',
      summary: 'Workspace operativo self-hosted para una persona y sus agentes de IA.',
      description: [
        'API para que los agentes trabajen sobre AgentDesk: leer su cola, mover tareas,',
        'escribir notas, aceptar delegaciones y reportar ejecuciones.',
        '',
        'Humano: cookie de sesión `ad_session`, obtenida con `/api/auth/login` o setup.',
        'Agentes: `Authorization: Bearer agt_…`. Hay un token por agente, con scopes.',
        'Escribir implica leer en la misma área (`tasks:write` concede `tasks:read`), `*` concede',
        'todo y un `403` siempre dice qué scope falta.',
        '',
        'Los agentes solo ven lo suyo: sus runs, sus delegaciones y su cola.',
        '',
        'Además de esta API REST hay un **servidor MCP en `POST /api/mcp`** (JSON-RPC 2.0 por',
        'Streamable HTTP, mismo token y mismos scopes), que es por donde pasa el flujo con',
        'humano en medio: reclamar una tarea con lease, proponer una delegación y pedir',
        'permiso. Al ser JSON-RPC no se describe en REST; `GET /api/mcp` enumera sus',
        'herramientas.',
        '',
        'Lo que un agente propone y no puede ejecutar solo queda como **aprobación**, que una',
        'persona decide en la web (`/approvals`). Falla cerrado: una aprobación caducada se le',
        'devuelve al agente como rechazada. El objeto está descrito en el esquema `Approval`,',
        'y viaja también en los webhooks `approval.requested` y `approval.decided`.',
      ].join('\n'),
    },
    servers: [{ url: baseUrl, description: 'Origen de esta petición' }],
    tags: [{ name: 'Humano', description: 'API de la aplicación, con cookie de sesión.' }, { name: 'Agentes', description: 'API de agentes, con token Bearer y scopes.' }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/me': {
        get: {
          tags: ['Identidad'],
          operationId: 'getMe',
          summary: 'Agente autenticado, sus scopes y sus contadores',
          description: 'No exige ningún scope: sirve para comprobar que un token está bien montado.',
          responses: { 200: jsonResponse('Agente autenticado', 'Me'), 401: errors[401] },
        },
      },
      '/api/v1/queue': {
        get: {
          tags: ['Cola'],
          operationId: 'getQueue',
          summary: 'Delegaciones accionables y tareas asignadas',
          description:
            'Lo que un agente consulta al despertar. Requiere `delegations:read`. Una delegación que exige aprobación no aparece hasta que un humano la aprueba.',
          responses: {
            200: jsonResponse('Cola de trabajo', 'Queue'),
            401: errors[401],
            403: errors[403],
          },
        },
      },
      '/api/v1/tasks': {
        get: {
          tags: ['Tareas'],
          operationId: 'listTasks',
          summary: 'Lista de tareas',
          description: 'Scope `tasks:read`.',
          parameters: taskFilters,
          responses: {
            200: jsonResponse('Tareas', 'TaskList'),
            401: errors[401],
            403: errors[403],
          },
        },
        post: {
          tags: ['Tareas'],
          operationId: 'createTask',
          summary: 'Crea una tarea',
          description:
            'Scope `tasks:write`. Si no se indica otra cosa, la tarea queda asignada al propio agente, que es lo que la hace aparecer en su cola.',
          requestBody: jsonBody('TaskCreate'),
          responses: {
            201: jsonResponse('Tarea creada', 'TaskEnvelope'),
            401: errors[401],
            403: errors[403],
            422: errors[422],
          },
        },
      },
      '/api/v1/tasks/{id}': {
        get: {
          tags: ['Tareas'],
          operationId: 'getTask',
          summary: 'Una tarea con sus subtareas',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Tarea', 'TaskEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
        patch: {
          tags: ['Tareas'],
          operationId: 'updateTask',
          summary: 'Modifica una tarea',
          description:
            'Completar una tarea recurrente no la cierra: la adelanta a su siguiente ocurrencia y la respuesta lo indica en `recurrenceAdvanced`.',
          parameters: [taskIdParam],
          requestBody: jsonBody('TaskUpdate'),
          responses: {
            200: jsonResponse('Tarea actualizada', 'TaskEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
        delete: {
          tags: ['Tareas'],
          operationId: 'deleteTask',
          summary: 'Borra una tarea',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Confirmación', 'Ok'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
      },
      '/api/v1/tasks/{id}/comments': {
        get: {
          tags: ['Tareas'],
          operationId: 'listTaskComments',
          summary: 'Comentarios de una tarea, en orden',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Comentarios', 'CommentList'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
        post: {
          tags: ['Tareas'],
          operationId: 'addTaskComment',
          summary: 'Comenta en una tarea',
          description:
            'Los comentarios son entradas de actividad: quedan en la cronología unificada y no se pueden editar ni borrar.',
          parameters: [taskIdParam],
          requestBody: jsonBody('CommentCreate'),
          responses: {
            201: jsonResponse('Comentario creado', 'CommentEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
      },
      '/api/v1/projects': {
        get: {
          tags: ['Proyectos'],
          operationId: 'listProjects',
          summary: 'Lista de proyectos',
          description: 'Scope `projects:read`.',
          parameters: [
            { name: 'includeArchived', in: 'query', schema: { type: 'boolean', default: false } },
          ],
          responses: {
            200: jsonResponse('Proyectos', 'ProjectList'),
            401: errors[401],
            403: errors[403],
          },
        },
        post: {
          tags: ['Proyectos'],
          operationId: 'createProject',
          summary: 'Crea un proyecto',
          description: 'Scope `projects:write`.',
          requestBody: jsonBody('ProjectCreate'),
          responses: {
            201: jsonResponse('Proyecto creado', 'ProjectEnvelope'),
            401: errors[401],
            403: errors[403],
            422: errors[422],
          },
        },
      },
      '/api/v1/notes': {
        get: {
          tags: ['Notas'],
          operationId: 'listNotes',
          summary: 'Lista de notas',
          description:
            'Scope `notes:read`. Devuelve la página, `total` y `nextOffset` (`null` en la última).',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string' } },
            { name: 'projectId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            {
              name: 'authorType',
              in: 'query',
              schema: { type: 'string', enum: ['human', 'agent', 'system'] },
            },
            { name: 'authorId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
            },
            {
              name: 'offset',
              in: 'query',
              schema: { type: 'integer', minimum: 0, default: 0 },
            },
          ],
          responses: {
            200: jsonResponse('Notas', 'NoteListPage'),
            401: errors[401],
            403: errors[403],
          },
        },
        post: {
          tags: ['Notas'],
          operationId: 'createNote',
          summary: 'Crea una nota',
          description:
            'Scope `notes:write`. El título es la identidad: dos notas no pueden llamarse igual (409). El autor sale del token.',
          requestBody: jsonBody('NoteCreate'),
          responses: {
            201: jsonResponse('Nota creada', 'NoteEnvelope'),
            401: errors[401],
            403: errors[403],
            409: { $ref: '#/components/responses/Conflict' },
            422: errors[422],
          },
        },
      },
      '/api/v1/notes/append': {
        post: {
          tags: ['Notas'],
          operationId: 'appendNote',
          summary: 'Añade Markdown a una nota (la crea si no existe)',
          description:
            'Scope `notes:write`. La escritura es atómica por nota. 201 si la creó, 200 si solo añadió. ' +
            'Si el cuerpo resultante supera 200 000 caracteres devuelve 422.',
          requestBody: jsonBody('NoteAppend'),
          responses: {
            200: jsonResponse('Contenido añadido', 'NoteAppendEnvelope'),
            201: jsonResponse('Nota creada', 'NoteAppendEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            409: { $ref: '#/components/responses/Conflict' },
            422: errors[422],
          },
        },
      },
      '/api/v1/notes/by-title': {
        get: {
          tags: ['Notas'],
          operationId: 'getNoteByTitle',
          summary: 'Una nota por título',
          description:
            'Scope `notes:read`. El título va en `?title=` porque puede contener `/`, `#` o acentos. ' +
            'La búsqueda ignora mayúsculas y acentos.',
          parameters: [
            { name: 'title', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: {
            200: jsonResponse('Nota', 'NoteDetailEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
        put: {
          tags: ['Notas'],
          operationId: 'upsertNoteByTitle',
          summary: 'Crea o reemplaza una nota por título',
          description:
            'Scope `notes:write`. 201 si la creó, 200 si la reemplazó. ' +
            '`createIfMissing: false` convierte una nota ausente en 404; ' +
            '`expectedUpdatedAt` convierte una edición concurrente en 409.',
          requestBody: jsonBody('NoteUpsert'),
          responses: {
            200: jsonResponse('Nota reemplazada', 'NoteAppendEnvelope'),
            201: jsonResponse('Nota creada', 'NoteAppendEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            409: { $ref: '#/components/responses/Conflict' },
            422: errors[422],
          },
        },
      },
      '/api/v1/notes/{id}': {
        get: {
          tags: ['Notas'],
          operationId: 'getNote',
          summary: 'Una nota con sus enlaces y backlinks',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Nota', 'NoteDetailEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
        patch: {
          tags: ['Notas'],
          operationId: 'updateNote',
          summary: 'Edita una nota',
          parameters: [taskIdParam],
          requestBody: jsonBody('NoteUpdate'),
          responses: {
            200: jsonResponse('Nota actualizada', 'NoteDetailEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            409: { $ref: '#/components/responses/Conflict' },
            422: errors[422],
          },
        },
        delete: {
          tags: ['Notas'],
          operationId: 'deleteNote',
          summary: 'Elimina una nota',
          description:
            'Scope `notes:write`. Es destructivo: los enlaces que apuntaban a la nota quedan sin destino. Devuelve 204.',
          parameters: [taskIdParam],
          responses: {
            204: { description: 'Nota eliminada' },
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
      },
      '/api/v1/delegations': {
        get: {
          tags: ['Delegaciones'],
          operationId: 'listDelegations',
          summary: 'Mis delegaciones',
          description: 'Scope `delegations:read`. Solo las dirigidas a este agente.',
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string' },
              description: 'Puede repetirse para pedir varios estados.',
            },
          ],
          responses: {
            200: jsonResponse('Delegaciones', 'DelegationList'),
            401: errors[401],
            403: errors[403],
          },
        },
        post: {
          tags: ['Delegaciones'],
          operationId: 'createDelegation',
          summary: 'Delega trabajo en otro agente',
          description: 'Scope `delegations:write`.',
          requestBody: jsonBody('DelegationCreate'),
          responses: {
            201: jsonResponse('Delegación creada', 'DelegationEnvelope'),
            401: errors[401],
            403: errors[403],
            422: errors[422],
          },
        },
      },
      '/api/v1/delegations/{id}': {
        get: {
          tags: ['Delegaciones'],
          operationId: 'getDelegation',
          summary: 'Una delegación propia',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Delegación', 'DelegationEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
        patch: {
          tags: ['Delegaciones'],
          operationId: 'updateDelegation',
          summary: 'Acepta, avanza o cierra una delegación',
          description:
            'Aceptar o cerrar una delegación ajena devuelve 403. El `note` opcional se añade como comentario en la tarea asociada.',
          parameters: [taskIdParam],
          requestBody: jsonBody('DelegationUpdate'),
          responses: {
            200: jsonResponse('Delegación actualizada', 'DelegationEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
      },
      '/api/v1/runs': {
        get: {
          tags: ['Runs'],
          operationId: 'listRuns',
          summary: 'Mis ejecuciones',
          description: 'Scope `runs:read`.',
          parameters: [
            { name: 'taskId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: jsonResponse('Runs', 'RunList'), 401: errors[401], 403: errors[403] },
        },
        post: {
          tags: ['Runs'],
          operationId: 'createRun',
          summary: 'Abre una ejecución',
          description:
            'Scope `runs:write`. Abrir un run sobre una delegación la pone en curso. Los tiempos los sella el servidor.',
          requestBody: jsonBody('RunCreate'),
          responses: {
            201: jsonResponse('Run abierto', 'RunEnvelope'),
            401: errors[401],
            403: errors[403],
            422: errors[422],
          },
        },
      },
      '/api/v1/runs/{id}': {
        get: {
          tags: ['Runs'],
          operationId: 'getRun',
          summary: 'Un run con sus logs y artefactos',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Detalle del run', 'RunDetail'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
          },
        },
        patch: {
          tags: ['Runs'],
          operationId: 'updateRun',
          summary: 'Actualiza o cierra una ejecución',
          description: 'Cerrar el run con `succeeded` cierra su delegación como `completed`.',
          parameters: [taskIdParam],
          requestBody: jsonBody('RunUpdate'),
          responses: {
            200: jsonResponse('Run actualizado', 'RunEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
      },
      '/api/v1/runs/{id}/logs': {
        get: {
          tags: ['Runs'],
          operationId: 'listRunLogs',
          summary: 'Logs de una ejecución',
          description: 'Con `since` (ISO) solo los posteriores, útil al reconectar.',
          parameters: [
            taskIdParam,
            { name: 'since', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: jsonResponse('Logs', 'RunLogList'), 401: errors[401], 403: errors[403] },
        },
        post: {
          tags: ['Runs'],
          operationId: 'appendRunLogs',
          summary: 'Añade una línea o un lote de logs',
          description: 'Acepta `{ logs: [...] }` o una sola línea `{ level, message }`.',
          parameters: [taskIdParam],
          requestBody: jsonBody('RunLogCreate'),
          responses: {
            201: jsonResponse('Logs añadidos', 'RunLogBatchResult'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
      },
      '/api/v1/runs/{id}/artifacts': {
        get: {
          tags: ['Runs'],
          operationId: 'listRunArtifacts',
          summary: 'Artefactos de una ejecución',
          parameters: [taskIdParam],
          responses: {
            200: jsonResponse('Artefactos', 'ArtifactList'),
            401: errors[401],
            403: errors[403],
          },
        },
        post: {
          tags: ['Runs'],
          operationId: 'createRunArtifact',
          summary: 'Adjunta un artefacto de texto, URL o fichero',
          description:
            'Los ficheros viajan en base64 dentro del JSON (`contentBase64`, hasta 8 MB), para que un agente no necesite más que un cliente HTTP.',
          parameters: [taskIdParam],
          requestBody: jsonBody('ArtifactCreate'),
          responses: {
            201: jsonResponse('Artefacto adjuntado', 'ArtifactEnvelope'),
            401: errors[401],
            403: errors[403],
            404: errors[404],
            422: errors[422],
          },
        },
      },
      '/api/v1/events': {
        get: {
          tags: ['Tiempo real'],
          operationId: 'streamEvents',
          summary: 'Flujo SSE de eventos',
          description: [
            'Server-Sent Events. Los eventos `run.*` llegan solo si son de los runs de este agente.',
            'Los nombres de evento son `run.log`, `run.updated`, `run.artifact`, `delegation.updated`,',
            '`task.changed`, `task.comment`, `note.changed` y `activity`; usa',
            '`addEventListener(nombre, …)`, no `onmessage`. Un `: keep-alive` cada 25 s.',
          ].join('\n'),
          responses: {
            200: {
              description: 'Flujo abierto',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            401: errors[401],
          },
        },
      },
    },
    components: {
      securitySchemes: {
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ad_session', description: 'Cookie HttpOnly emitida por login/setup. En el navegador inicia sesión para probar las operaciones.' },
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Token de agente: `agt_` + 43 caracteres base64url.',
        },
      },
      responses: {
        Unauthorized: {
          description: 'Falta el token, o es desconocido, revocado o caducado.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Token válido sin el scope necesario, o agente archivado.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'No existe (o el id no es un UUID).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Invalid: {
          description: 'El cuerpo no pasa la validación.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Conflict: {
          description: 'Choca con algo existente, por ejemplo un título de nota repetido.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
      schemas: {
        Error: errorSchema,
        Ok: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
        },
        Agent: agentSchema,
        Me: {
          type: 'object',
          properties: {
            agent: agentSchema,
            scopes: { type: 'array', items: { type: 'string' } },
            counts: { type: 'object' },
          },
        },
        Task: taskSchema,
        Approval: approvalSchema,
        TaskEnvelope: {
          type: 'object',
          properties: {
            task: { $ref: '#/components/schemas/Task' },
            recurrenceAdvanced: {
              nullable: true,
              type: 'object',
              properties: {
                from: { type: 'string', format: 'date', nullable: true },
                to: { type: 'string', format: 'date' },
              },
            },
          },
        },
        TaskList: listOf('tasks', 'Task'),
        TaskCreate: inputSchema(validation.taskCreateSchema),
        TaskUpdate: inputSchema(validation.taskUpdateSchema),
        Activity: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            actorType: { type: 'string', enum: ['human', 'agent', 'system'] },
            actorId: { type: 'string', format: 'uuid', nullable: true },
            actorName: { type: 'string' },
            action: { type: 'string', description: 'Nombre legible de la acción, p. ej. `task.status_changed`.' },
            entityType: { type: 'string', nullable: true },
            entityId: { type: 'string', format: 'uuid', nullable: true },
            meta: { type: 'object', nullable: true, additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Comment: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            taskId: { type: 'string', format: 'uuid' },
            authorType: { type: 'string', enum: ['human', 'agent', 'system'] },
            authorName: { type: 'string' },
            body: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CommentEnvelope: {
          type: 'object',
          properties: { comment: { $ref: '#/components/schemas/Comment' } },
        },
        CommentList: {
          type: 'object',
          properties: {
            comments: { type: 'array', items: { $ref: '#/components/schemas/Comment' } },
          },
        },
        CommentCreate: inputSchema(validation.commentCreateSchema),
        Project: projectSchema,
        ProjectEnvelope: {
          type: 'object',
          properties: { project: { $ref: '#/components/schemas/Project' } },
        },
        ProjectList: listOf('projects', 'Project'),
        ProjectCreate: inputSchema(validation.projectCreateSchema),
        Note: noteSchema,
        NoteEnvelope: {
          type: 'object',
          properties: { note: { $ref: '#/components/schemas/Note' } },
        },
        NoteDetailEnvelope: {
          type: 'object',
          properties: {
            note: { $ref: '#/components/schemas/Note' },
            links: { type: 'array', items: { type: 'object' } },
            backlinks: { type: 'array', items: { type: 'object' } },
          },
        },
        NoteList: listOf('notes', 'NoteListItem'),
        NoteListItem: noteListItemSchema,
        NoteListPage: {
          type: 'object',
          properties: {
            notes: { type: 'array', items: { $ref: '#/components/schemas/NoteListItem' } },
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
            nextOffset: { type: 'integer', nullable: true },
          },
        },
        NoteAppendEnvelope: {
          type: 'object',
          properties: {
            note: { $ref: '#/components/schemas/Note' },
            project: { nullable: true, type: 'object' },
            backlinks: { type: 'array', items: { type: 'object' } },
            outgoing: { type: 'array', items: { type: 'object' } },
            related: { type: 'array', items: { type: 'object' } },
            created: { type: 'boolean' },
          },
        },
        NoteCreate: inputSchema(validation.noteCreateSchema),
        NoteUpdate: inputSchema(validation.noteUpdateSchema),
        NoteAppend: inputSchema(validation.noteAppendSchema),
        NoteUpsert: inputSchema(validation.noteUpsertSchema),
        Delegation: delegationSchema,
        DelegationEnvelope: {
          type: 'object',
          properties: { delegation: { $ref: '#/components/schemas/Delegation' } },
        },
        DelegationList: listOf('delegations', 'Delegation'),
        DelegationCreate: inputSchema(validation.delegationCreateSchema),
        DelegationUpdate: inputSchema(validation.delegationUpdateSchema),
        Run: runSchema,
        RunEnvelope: { type: 'object', properties: { run: { $ref: '#/components/schemas/Run' } } },
        RunList: listOf('runs', 'Run'),
        RunDetail: {
          type: 'object',
          properties: {
            run: { $ref: '#/components/schemas/Run' },
            logs: { type: 'array', items: { $ref: '#/components/schemas/RunLog' } },
            artifacts: { type: 'array', items: { $ref: '#/components/schemas/Artifact' } },
          },
        },
        RunCreate: inputSchema(validation.runCreateSchema),
        RunUpdate: inputSchema(validation.runUpdateSchema),
        RunLog: runLogSchema,
        RunLogList: {
          type: 'object',
          properties: { logs: { type: 'array', items: { $ref: '#/components/schemas/RunLog' } } },
        },
        RunLogCreate: inputSchema(z.union([validation.runLogCreateSchema, validation.runLogBatchSchema])),
        RunLogBatchResult: {
          type: 'object',
          properties: {
            logs: { type: 'array', items: { $ref: '#/components/schemas/RunLog' } },
            log: { $ref: '#/components/schemas/RunLog' },
          },
        },
        Artifact: artifactSchema,
        ArtifactEnvelope: {
          type: 'object',
          properties: { artifact: { $ref: '#/components/schemas/Artifact' } },
        },
        ArtifactList: {
          type: 'object',
          properties: { artifacts: { type: 'array', items: { $ref: '#/components/schemas/Artifact' } } },
        },
        ArtifactCreate: inputSchema(validation.artifactCreateSchema),
        Queue: {
          type: 'object',
          properties: {
            agent: agentSchema,
            delegations: {
              type: 'array',
              items: { $ref: '#/components/schemas/Delegation' },
            },
            tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } },
          },
        },
      },
    },
    'x-webhooks': {
      description:
        'AgentDesk también puede avisar hacia fuera. Se configuran en Ajustes y cada entrega va firmada con HMAC-SHA256.',
      post: {
        summary: 'Notificación de un evento',
        description: [
          'Cuerpo: `{ event, at, delivery, webhookId, data }`.',
          'Cabeceras: `X-AgentDesk-Signature: t=<segundos>,v1=<hmac>`,',
          '`X-AgentDesk-Event`, `X-AgentDesk-Delivery`.',
          'La firma es `HMAC_SHA256(secreto, "<t>.<cuerpo>")` en hexadecimal.',
        ].join(' '),
      },
    },
  };
  for (const item of Object.values(document.paths)) {
    for (const operation of Object.values(item)) {
      operation.tags = ['Agentes'];
      Object.assign(operation, { security: [{ bearerAuth: [] }] });
    }
  }
  return { ...document, paths: { ...document.paths, ...humanPaths() } };
}
