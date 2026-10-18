/*
# MCP gateway edge function

Exposes the workspace as an MCP (Model Context Protocol) server over HTTP so local agents
(Claude Desktop, Cursor, CLI agents) can use it as native tools.

Transport: MCP Streamable HTTP (JSON-RPC 2.0) at POST /functions/v1/mcp-gateway.
Authentication: `Authorization: Bearer <agent token>` (same per-agent tokens as agent-api).
The token identifies which agent is calling; all mutations are attributed to that agent's actor.

Supported MCP methods:
- initialize            -> server info + tool list capabilities
- notifications/initialized (accepted, no response payload needed)
- tools/list            -> the workspace tools
- tools/call            -> executes a tool; result is attributed + audited
- ping                  -> pong

Tools (mapped to agent-api style operations):
- list_delegations      -> pending/in_progress delegations for this agent
- read_task             -> task detail (own delegations only)
- start_run             -> begin execution of a delegation
- update_run            -> finish/update a run (summary, error, status)
- add_artifact          -> attach a result artifact to a run/task
- add_note              -> attach a work note to a task
- propose_task          -> create a new task in Inbox (origin=agent)
- search_tasks          -> search this agent's delegated tasks by title substring

Permission checks are identical to agent-api (agents.permissions jsonb).
Every tools/call writes a timeline event attributed to the agent.

Authentication: required on every request, including initialize, tools/list and
ping. The catalog of tools is not something an unauthenticated caller should be
able to enumerate, and MCP clients send the Authorization header throughout.

Input validation: `inputSchema` below is not merely documentation. Each tool
declares a validate() that runs before executeTool(), so a client that ignores
the advertised schema still cannot send wrong types, oversized strings or
unexpected keys. `additionalProperties: false` is enforced, not assumed.

Ownership rules: a task is visible to an agent only if it appears in one of that
agent's delegations. search_tasks is scoped the same way as read_task.

No CORS headers: MCP clients are local processes authenticating with a bearer
token, which is not a browser credential, so no cross-origin surface is needed.
*/

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

const PROTOCOL_VERSION = '2025-03-26';

const MAX_TITLE = 300;
const MAX_TEXT = 20000;
const MAX_QUERY = 200;
const MAX_URL = 2048;
const MAX_ID = 64;

class ValidationError extends Error {}

/** Rejects any key not listed, so an agent cannot smuggle extra columns through. */
function shape(args: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new ValidationError(`Unexpected argument: ${key}`);
  }
}

function str(args: Record<string, unknown>, key: string, max: number): string | undefined {
  if (args[key] === undefined || args[key] === null) return undefined;
  if (typeof args[key] !== 'string') throw new ValidationError(`${key} must be a string`);
  if ((args[key] as string).length > max) throw new ValidationError(`${key} exceeds ${max} characters`);
  return args[key] as string;
}

function reqStr(args: Record<string, unknown>, key: string, max: number): string {
  const value = str(args, key, max);
  if (value === undefined || !value.trim()) {
    throw new ValidationError(`${key} must be a non-empty string under ${max} characters`);
  }
  return value.trim();
}

function oneOf<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[], fallback?: T): T | undefined {
  if (args[key] === undefined || args[key] === null) return fallback;
  if (!allowed.includes(args[key] as T)) throw new ValidationError(`${key} must be one of: ${allowed.join(', ')}`);
  return args[key] as T;
}

function object(args: Record<string, unknown>, key: string, maxKeys: number): Record<string, unknown> {
  const value = args[key];
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${key} must be an object`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maxKeys) throw new ValidationError(`${key} has too many keys`);
  return value as Record<string, unknown>;
}

function jsonrpc(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonrpcError(id: unknown, code: number, message: string, status = 200): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface AgentRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  permissions: string[];
  actor_id: string | null;
}

async function authenticate(req: Request, admin: SupabaseClient): Promise<AgentRow | null> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !token.startsWith('agt_')) return null;
  const tokenHash = await sha256Hex(token);
  const { data } = await admin
    .from('agents')
    .select('id, name, kind, status, permissions, actor_id')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (!data || (data as AgentRow).status !== 'active') return null;
  return data as AgentRow;
}

// ============ Tool definitions ============

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: string;
  /** Returns normalised arguments; throws ValidationError on anything malformed. */
  validate: (args: Record<string, unknown>) => Record<string, unknown>;
}

const NO_ARGS: ToolDef['validate'] = (args) => {
  shape(args, []);
  return {};
};

const TOOLS: ToolDef[] = [
  {
    name: 'list_delegations',
    description: 'Lista las delegaciones pendientes o en curso asignadas a este agente, con su tarea y contexto adjunto.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    permission: 'read_delegations',
    validate: NO_ARGS,
  },
  {
    name: 'read_task',
    description: 'Lee el detalle completo de una tarea (solo tareas que forman parte de las delegaciones de este agente).',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'ID de la tarea' } },
      required: ['task_id'],
      additionalProperties: false,
    },
    permission: 'read_tasks',
    validate: (args) => {
      shape(args, ['task_id']);
      return { task_id: reqStr(args, 'task_id', MAX_ID) };
    },
  },
  {
    name: 'search_tasks',
    description: 'Busca tareas por substring en el título, entre las tareas delegadas a este agente.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Texto a buscar en el título' } },
      required: ['query'],
      additionalProperties: false,
    },
    permission: 'read_tasks',
    validate: (args) => {
      shape(args, ['query']);
      return { query: reqStr(args, 'query', MAX_QUERY) };
    },
  },
  {
    name: 'start_run',
    description: 'Inicia una ejecución (run) de una delegación. Devuelve el run creado; usa su ID para actualizarlo después.',
    inputSchema: {
      type: 'object',
      properties: {
        delegation_id: { type: 'string', description: 'ID de la delegación' },
        input: { type: 'object', description: 'Snapshot opcional de la entrada/ejecución', additionalProperties: true },
      },
      required: ['delegation_id'],
      additionalProperties: false,
    },
    permission: 'write_runs',
    validate: (args) => {
      shape(args, ['delegation_id', 'input']);
      return { delegation_id: reqStr(args, 'delegation_id', MAX_ID), input: object(args, 'input', 100) };
    },
  },
  {
    name: 'update_run',
    description: 'Actualiza una ejecución propia: estado (running|succeeded|failed), resumen y/o error.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        status: { type: 'string', enum: ['running', 'succeeded', 'failed'] },
        summary: { type: 'string', description: 'Resumen de lo ejecutado' },
        error: { type: 'string', description: 'Detalle del fallo si status=failed' },
      },
      required: ['run_id', 'status'],
      additionalProperties: false,
    },
    permission: 'write_runs',
    validate: (args) => {
      shape(args, ['run_id', 'status', 'summary', 'error']);
      return {
        run_id: reqStr(args, 'run_id', MAX_ID),
        status: reqStr(args, 'status', 20),
        summary: str(args, 'summary', MAX_TEXT),
        error: str(args, 'error', MAX_TEXT),
      };
    },
  },
  {
    name: 'add_artifact',
    description: 'Adjunta un artefacto resultado (texto, código o URL) a un run y/o tarea propia.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        task_id: { type: 'string' },
        kind: { type: 'string', enum: ['text', 'code', 'url', 'file'] },
        title: { type: 'string', description: 'Título del artefacto' },
        content_text: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    permission: 'write_artifacts',
    validate: (args) => {
      shape(args, ['run_id', 'task_id', 'kind', 'title', 'content_text', 'url']);
      return {
        title: reqStr(args, 'title', MAX_TITLE),
        kind: oneOf(args, 'kind', ['text', 'code', 'url', 'file'] as const, 'text'),
        run_id: str(args, 'run_id', MAX_ID),
        task_id: str(args, 'task_id', MAX_ID),
        content_text: str(args, 'content_text', MAX_TEXT),
        url: str(args, 'url', MAX_URL),
      };
    },
  },
  {
    name: 'add_note',
    description: 'Añade una nota de trabajo a una tarea propia.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        title: { type: 'string' },
        body_md: { type: 'string' },
      },
      required: ['task_id', 'title'],
      additionalProperties: false,
    },
    // Was 'read_tasks', which meant a read permission gated a write.
    permission: 'write_notes',
    validate: (args) => {
      shape(args, ['task_id', 'title', 'body_md']);
      return {
        task_id: reqStr(args, 'task_id', MAX_ID),
        title: reqStr(args, 'title', MAX_TITLE),
        body_md: str(args, 'body_md', MAX_TEXT),
      };
    },
  },
  {
    name: 'propose_task',
    description: 'Crea una tarea nueva en el Inbox con origen agente (por ejemplo, siguiente paso propuesto tras una ejecución).',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'normal', 'low'] },
        due_date: { type: 'string', description: 'Fecha yyyy-MM-dd' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    permission: 'propose_task',
    validate: (args) => {
      shape(args, ['title', 'description', 'priority', 'due_date']);
      return {
        title: reqStr(args, 'title', MAX_TITLE),
        description: str(args, 'description', MAX_TEXT),
        priority: oneOf(args, 'priority', ['urgent', 'high', 'normal', 'low'] as const, 'normal'),
        due_date: str(args, 'due_date', 10),
      };
    },
  },
];

// ============ Tool execution ============

async function executeTool(
  admin: SupabaseClient,
  agent: AgentRow,
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const logEvent = async (kind: string, entityType: string, entityId: string | null, entityTitle: string | null, payload: Record<string, unknown> = {}) => {
    await admin.from('events').insert({
      kind, actor_id: agent.actor_id, entity_type: entityType, entity_id: entityId, entity_title: entityTitle, payload,
    });
  };

  switch (name) {
    case 'list_delegations': {
      const { data, error } = await admin
        .from('delegations')
        .select('*, task:tasks(*), context:delegation_context(*)')
        .eq('agent_id', agent.id)
        .in('status', ['pending', 'in_progress'])
        .order('created_at');
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: { delegations: data ?? [] } };
    }

    case 'read_task': {
      const taskId = args.task_id as string;
      const { data: link } = await admin
        .from('delegations')
        .select('task_id')
        .eq('agent_id', agent.id)
        .eq('task_id', taskId)
        .maybeSingle();
      if (!link) return { ok: false, error: 'Task is not part of this agent delegations' };
      const { data: task, error } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: { task } };
    }

    case 'search_tasks': {
      // Scoped to this agent's delegated tasks, matching read_task. It used to
      // return every non-done task in the workspace.
      const query = (args.query as string).replace(/[%_]/g, (c) => `\\${c}`);
      const { data: links, error: linkError } = await admin
        .from('delegations')
        .select('task_id')
        .eq('agent_id', agent.id);
      if (linkError) return { ok: false, error: linkError.message };
      const taskIds = (links ?? []).map((l) => (l as { task_id: string }).task_id);
      if (taskIds.length === 0) return { ok: true, data: { tasks: [] } };
      const { data, error } = await admin
        .from('tasks')
        .select('id, title, status, priority, due_date, project_id, origin')
        .in('id', taskIds)
        .ilike('title', `%${query}%`)
        .neq('status', 'done')
        .limit(20);
      if (error) return { ok: false, error: error.message };
      return { ok: true, data: { tasks: data ?? [] } };
    }

    case 'start_run': {
      const delegationId = args.delegation_id as string;
      const { data: delegation } = await admin
        .from('delegations')
        .select('id, agent_id')
        .eq('id', delegationId)
        .maybeSingle();
      if (!delegation || (delegation as { agent_id: string }).agent_id !== agent.id) {
        return { ok: false, error: 'Delegation not found for this agent' };
      }
      const { data: run, error } = await admin
        .from('runs')
        .insert({
          delegation_id: delegationId,
          agent_id: agent.id,
          status: 'started',
          input: (args.input as Record<string, unknown>) ?? {},
        })
        .select('*')
        .single();
      if (error) return { ok: false, error: error.message };
      await logEvent('run.started', 'run', (run as { id: string }).id, null, { delegation_id: delegationId, via: 'mcp' });
      return { ok: true, data: { run } };
    }

    case 'update_run': {
      const runId = args.run_id as string;
      const status = args.status as string;
      const { data: existing } = await admin.from('runs').select('id, agent_id, started_at').eq('id', runId).maybeSingle();
      if (!existing || (existing as { agent_id: string }).agent_id !== agent.id) {
        return { ok: false, error: 'Run not found for this agent' };
      }
      const patch: Record<string, unknown> = { status };
      if (typeof args.summary === 'string') patch.summary = args.summary;
      if (typeof args.error === 'string') patch.error = args.error;
      if (status === 'succeeded' || status === 'failed') {
        patch.finished_at = new Date().toISOString();
        patch.duration_ms = Date.now() - new Date((existing as { started_at: string }).started_at).getTime();
      }
      const { data: run, error } = await admin.from('runs').update(patch).eq('id', runId).select('*').single();
      if (error) return { ok: false, error: error.message };
      await logEvent(`run.status_${status}`, 'run', runId, typeof args.summary === 'string' ? (args.summary as string).slice(0, 80) : null, { via: 'mcp' });
      return { ok: true, data: { run } };
    }

    case 'add_artifact': {
      const title = args.title as string;
      const patch: Record<string, unknown> = {
        agent_id: agent.id,
        kind: (args.kind as string) ?? 'text',
        title,
        content_text: (args.content_text as string) ?? null,
        url: (args.url as string) ?? null,
        run_id: (args.run_id as string) ?? null,
        task_id: (args.task_id as string) ?? null,
      };
      if (patch.run_id) {
        const { data: run } = await admin.from('runs').select('id, agent_id').eq('id', patch.run_id as string).maybeSingle();
        if (!run || (run as { agent_id: string }).agent_id !== agent.id) return { ok: false, error: 'run_id not owned by this agent' };
      }
      if (patch.task_id) {
        const { data: link } = await admin
          .from('delegations')
          .select('task_id')
          .eq('agent_id', agent.id)
          .eq('task_id', patch.task_id as string)
          .maybeSingle();
        if (!link) return { ok: false, error: 'task_id is not part of this agent delegations' };
      }
      if (!patch.run_id && !patch.task_id) return { ok: false, error: 'add_artifact requires run_id or task_id' };
      const { data: artifact, error } = await admin.from('artifacts').insert(patch).select('*').single();
      if (error) return { ok: false, error: error.message };
      await logEvent('artifact.created', 'artifact', (artifact as { id: string }).id, title, { via: 'mcp' });
      return { ok: true, data: { artifact } };
    }

    case 'add_note': {
      const taskId = args.task_id as string;
      const title = args.title as string;
      const { data: link } = await admin
        .from('delegations')
        .select('task_id')
        .eq('agent_id', agent.id)
        .eq('task_id', taskId)
        .maybeSingle();
      if (!link) return { ok: false, error: 'Task is not part of this agent delegations' };
      const { data: note, error } = await admin
        .from('notes')
        .insert({ title, body_md: (args.body_md as string) ?? '', task_id: taskId, source: 'app' })
        .select('*')
        .single();
      if (error) return { ok: false, error: error.message };
      await logEvent('note.created', 'note', (note as { id: string }).id, title, { by_agent: agent.name, via: 'mcp' });
      return { ok: true, data: { note } };
    }

    case 'propose_task': {
      const title = args.title as string;
      const { data: task, error } = await admin
        .from('tasks')
        .insert({
          title,
          description: (args.description as string) ?? null,
          priority: (args.priority as string) ?? 'normal',
          due_date: (args.due_date as string) ?? null,
          origin: 'agent',
          status: 'backlog',
        })
        .select('*')
        .single();
      if (error) return { ok: false, error: error.message };
      await logEvent('task.created', 'task', (task as { id: string }).id, title, { origin: 'agent', by_agent: agent.name, via: 'mcp' });
      return { ok: true, data: { task } };
    }

    default:
      return { ok: false, error: `Unknown tool: ${name}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') {
    return jsonrpcError(null, -32601, 'GET not supported; use POST with JSON-RPC 2.0', 405);
  }

  if (req.method !== 'POST') {
    return jsonrpcError(null, -32601, 'Method not allowed', 405);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonrpcError(null, -32700, 'Parse error', 400);
    }

    // Every request is authenticated, including initialize, tools/list and ping.
    const agent = await authenticate(req, admin);
    if (!agent) {
      return jsonrpcError(null, -32001, 'Unauthorized: invalid or inactive agent token', 401);
    }

    const messages = Array.isArray(body) ? (body as Record<string, unknown>[]) : [body as Record<string, unknown>];
    const responses: unknown[] = [];

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') {
        responses.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
        continue;
      }
      const id = msg.id ?? null;
      const method = typeof msg.method === 'string' ? msg.method : '';

      if (method === 'initialize') {
        responses.push({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'operative-mcp-gateway', version: '1.0.0' },
          },
        });
        continue;
      }

      if (method.startsWith('notifications/')) {
        continue;
      }

      if (method === 'ping') {
        responses.push({ jsonrpc: '2.0', id, result: {} });
        continue;
      }

      if (method === 'tools/list') {
        responses.push({
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        });
        continue;
      }

      if (method === 'tools/call') {
        const params = (msg.params ?? {}) as Record<string, unknown>;
        const name = typeof params.name === 'string' ? params.name : '';
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) {
          responses.push({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
          continue;
        }
        if (!(agent.permissions as string[]).includes(tool.permission)) {
          responses.push({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `Permission denied: missing ${tool.permission}` }],
              isError: true,
            },
          });
          continue;
        }

        const raw = params.arguments ?? {};
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          responses.push({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: 'Invalid arguments: must be an object' }], isError: true },
          });
          continue;
        }

        // The advertised inputSchema is enforced here, not merely documented.
        let args: Record<string, unknown>;
        try {
          args = tool.validate(raw as Record<string, unknown>);
        } catch (e) {
          if (e instanceof ValidationError) {
            responses.push({
              jsonrpc: '2.0',
              id,
              result: { content: [{ type: 'text', text: `Invalid arguments: ${e.message}` }], isError: true },
            });
            continue;
          }
          throw e;
        }

        const outcome = await executeTool(admin, agent, name, args);
        responses.push({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify(outcome.ok ? outcome.data : { error: outcome.error }),
            }],
            isError: !outcome.ok,
          },
        });
        continue;
      }

      responses.push({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }

    if (responses.length === 0) {
      return new Response(null, { status: 202 });
    }

    return new Response(
      JSON.stringify(Array.isArray(body) ? responses : responses[0]),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('mcp-gateway error', e);
    return jsonrpcError(null, -32603, 'Internal error', 500);
  }
});
