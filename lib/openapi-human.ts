import { z } from 'zod';
import * as v from '@/lib/validation';

type Json = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const query = (...names: string[]) => names.map((name) => ({ name, in: 'query', schema: { type: 'string' } }));
const response = (schema: Json = { type: 'object' }, media = 'application/json') => ({
  description: 'Respuesta correcta', content: { [media]: { schema } },
});

/** Explicit route inventory: documentation never imports handlers or their DB dependencies. */
export function humanPaths(): Record<string, Record<string, Json>> {
  const paths: Record<string, Record<string, Json>> = {};
  function add(path: string, method: string, summary: string, options: {
    body?: z.ZodType; schema?: Json; status?: number; media?: string;
    parameters?: Json[]; public?: boolean; description?: string;
  } = {}) {
    const parameters = [...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }] : []), ...(options.parameters ?? [])];
    const operation: Json = {
      tags: ['Humano'], operationId: `human_${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      summary, security: options.public ? [] : [{ cookieAuth: [] }],
      ...(options.description ? { description: options.description } : {}),
      ...(parameters.length ? { parameters } : {}),
      responses: {
        [options.status ?? 200]: response(options.schema, options.media),
        ...(!options.public ? { 401: { description: 'Sesión ausente o caducada', content: { 'application/json': { schema: ref('Error') } } } } : {}),
        ...(path.includes('{id}') ? { 404: { $ref: '#/components/responses/NotFound' } } : {}),
        ...(options.body ? { 422: { $ref: '#/components/responses/Invalid' }, 409: { $ref: '#/components/responses/Conflict' } } : {}),
      },
    };
    if (options.body) {
      const { $schema, ...schema } = z.toJSONSchema(options.body, { io: 'input' });
      operation.requestBody = { required: true, content: { 'application/json': { schema } } };
    }
    (paths[path] ??= {})[method] = operation;
  }
  const envelope = (key: string, name: string): Json => ({ type: 'object', properties: { [key]: ref(name) } });
  const list = (key: string, name: string): Json => ({ type: 'object', properties: { [key]: { type: 'array', items: ref(name) } } });
  const taskQueries = query('status', 'priority', 'projectId', 'assigneeType', 'q', 'dueBefore', 'dueAfter', 'rootOnly', 'inbox', 'order');
  for (const [resource, singular, model, create, update] of [
    ['tasks', 'task', 'Task', v.taskCreateSchema, v.taskUpdateSchema.extend(v.taskLabelsSchema.partial().shape)],
    ['projects', 'project', 'Project', v.projectCreateSchema, v.projectUpdateSchema],
    ['notes', 'note', 'Note', v.noteCreateSchema, v.noteUpdateSchema],
    ['agents', 'agent', 'Agent', v.agentCreateSchema, v.agentUpdateSchema],
  ] as const) {
    const parameters = resource === 'tasks' ? taskQueries : resource === 'projects' ? query('includeArchived') : resource === 'notes' ? query('q', 'projectId') : query('archived');
    add(`/api/${resource}`, 'get', `Lista de ${resource}`, { schema: list(resource, model), parameters });
    add(`/api/${resource}`, 'post', `Crear ${singular}`, { body: create, schema: envelope(singular, model), status: 201 });
    // Detail responses may include additional related entities (subtasks, links, tokens…).
    add(`/api/${resource}/{id}`, 'get', `Detalle de ${singular}`, { schema: envelope(singular, model) });
    add(`/api/${resource}/{id}`, 'patch', `Actualizar ${singular}`, { body: update, schema: envelope(singular, model) });
    add(`/api/${resource}/{id}`, 'delete', `Eliminar ${singular}`, { schema: ref('Ok') });
  }
  add('/api/tasks/{id}/activity', 'get', 'Historial de cambios de una tarea', {
    schema: list('activity', 'Activity'),
    description: 'Cronología propia de la tarea: creación, cambios de estado y autonomía, comentarios y cierres.',
  });
  add('/api/auth/login', 'post', 'Iniciar sesión', { public: true, body: v.loginSchema, description: 'Emite la cookie HttpOnly ad_session. Credenciales incorrectas: 401.' });
  add('/api/auth/setup', 'get', 'Disponibilidad de la configuración inicial', { public: true });
  add('/api/auth/setup', 'post', 'Crear el primer usuario y su sesión', { public: true, body: v.setupSchema, status: 201, description: 'Solo disponible mientras no existan usuarios; en otro caso devuelve 409.' });
  add('/api/auth/logout', 'post', 'Cerrar sesión', { public: true, schema: ref('Ok') });
  add('/api/auth/me', 'get', 'Usuario de la sesión');
  add('/api/capture', 'post', 'Capturar una tarea en lenguaje natural', { body: v.captureSchema, status: 201 });
  add('/api/labels', 'get', 'Lista de etiquetas');
  add('/api/labels', 'post', 'Crear etiqueta', { body: v.labelCreateSchema, status: 201 });
  add('/api/labels/{id}', 'delete', 'Eliminar etiqueta', { schema: ref('Ok') });
  add('/api/notes/import', 'post', 'Importar notas Markdown', { body: v.noteImportSchema });
  add('/api/notes/export', 'get', 'Exportar notas como ZIP', { media: 'application/zip', schema: { type: 'string', format: 'binary' } });
  add('/api/delegations', 'get', 'Lista de delegaciones', { parameters: query('agentId', 'taskId', 'status'), schema: list('delegations', 'Delegation') });
  add('/api/delegations', 'post', 'Crear delegación', { body: v.delegationCreateSchema, status: 201, schema: envelope('delegation', 'Delegation') });
  add('/api/delegations/{id}', 'get', 'Detalle de delegación', { schema: envelope('delegation', 'Delegation') });
  add('/api/delegations/{id}', 'patch', 'Revisar o actualizar delegación', { body: z.union([v.delegationReviewSchema, v.delegationUpdateSchema]), schema: envelope('delegation', 'Delegation') });
  add('/api/approvals', 'get', 'Lista de aprobaciones', { parameters: query('status', 'taskId', 'agentId'), schema: list('approvals', 'Approval') });
  add('/api/approvals/{id}', 'get', 'Detalle de aprobación', { schema: envelope('approval', 'Approval') });
  add('/api/approvals/{id}', 'patch', 'Decidir aprobación', { body: v.approvalDecisionSchema, schema: envelope('approval', 'Approval'), description: 'Rechazar exige reason. Una decisión ya tomada o caducada devuelve 409.' });
  add('/api/runs', 'get', 'Lista de ejecuciones', { parameters: query('status', 'agentId', 'taskId'), schema: list('runs', 'Run') });
  add('/api/runs/{id}', 'get', 'Detalle de ejecución', { schema: ref('RunDetail') });
  add('/api/agents/{id}/tokens', 'get', 'Tokens del agente (sin secretos)');
  add('/api/agents/{id}/tokens', 'post', 'Crear token (secreto visible una sola vez)', { body: v.tokenCreateSchema, status: 201 });
  add('/api/tokens/{id}', 'delete', 'Revocar o eliminar token', { parameters: query('hard'), schema: ref('Ok') });
  add('/api/search', 'get', 'Buscar tareas y proyectos', { parameters: query('q') });
  add('/api/webhooks', 'get', 'Lista de webhooks');
  add('/api/webhooks', 'post', 'Crear webhook', { body: v.webhookCreateSchema, status: 201 });
  add('/api/webhooks/{id}', 'get', 'Detalle de webhook');
  add('/api/webhooks/{id}', 'patch', 'Actualizar webhook', { body: v.webhookUpdateSchema });
  add('/api/webhooks/{id}', 'delete', 'Eliminar webhook', { schema: ref('Ok') });
  add('/api/webhooks/{id}/test', 'post', 'Enviar evento de prueba');
  add('/api/events', 'get', 'Flujo de eventos de la aplicación', { media: 'text/event-stream', schema: { type: 'string' } });
  add('/api/artifacts/{id}', 'get', 'Descargar artefacto', { media: 'application/octet-stream', schema: { type: 'string', format: 'binary' }, description: 'Texto/URL en línea o fichero con su MIME. Bearer requiere runs:read.' });
  paths['/api/artifacts/{id}'].get.tags = ['Humano', 'Agentes'];
  paths['/api/artifacts/{id}'].get.security = [{ cookieAuth: [] }, { bearerAuth: [] }];
  return paths;
}
