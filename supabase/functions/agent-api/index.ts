/*
# Agent API edge function

Server-side API for AI agents (organizer/executor/analyst) to operate on the workspace.

Authentication: `Authorization: Bearer <agent token>` where the token was generated at agent
registration (shown once in the UI). Tokens are stored as sha256 hashes in `agents.token_hash`,
which is indexed by migration 20261018120100, so validation is a single index lookup.

Routes (all POST unless noted):
- GET  /agent-api           -> identity: agent name, kind, permissions
- POST /agent-api           -> route dispatcher via { action, ...payload }
Actions:
- list_delegations          -> pending/in_progress delegations for this agent (with task + context)
- start_run                 -> { delegation_id, input? } creates a run (status started)
- update_run                -> { run_id, status, summary?, error? } updates own run
- add_artifact              -> { run_id?, task_id?, kind, title, content_text?, url? }
- read_task                 -> { task_id } read a task's full detail (own delegations only)
- add_note                  -> { task_id, title, body_md }
- propose_task              -> { title, description?, priority?, due_date? } creates a task in Inbox
                                with origin=agent and a delegation? no — plain task, origin agent.

Permission model (agents.permissions jsonb):
- read_delegations, write_runs, write_artifacts, write_notes, read_tasks, propose_task

Ownership rules: every write is scoped to this agent. run_id must belong to a
run this agent started; task_id must be part of one of this agent's
delegations. There is no workspace-wide write.

Input limits: titles are capped at 300 characters, free text at 20k, and every
field is type-checked before it reaches the database. Caller-safe validation
problems return 400; database errors are logged server-side and returned as an
opaque 500.

No CORS headers: the only clients are the workspace's own agents over a bearer
token, which is not a browser credential, so no cross-origin surface is needed.
*/

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

const MAX_TITLE = 300;
const MAX_TEXT = 20000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/** Database errors are logged server-side and surfaced as a generic 500. */
function dbErr(e: unknown, context: string): Response {
  console.error(context, e);
  return err('Internal error', 500);
}

/** Caller-safe validation failure; anything else is treated as internal. */
class ValidationError extends Error {}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function requiredStr(value: unknown, max: number, field: string): string {
  const s = str(value, max);
  if (s === null || !s.trim()) throw new ValidationError(`${field} must be a non-empty string under ${max} characters`);
  return s.trim();
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
  if (!data) return null;
  if ((data as AgentRow).status !== 'active') return null;
  return data as AgentRow;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const agent = await authenticate(req, admin);
    if (!agent) return err('Unauthorized: invalid or inactive agent token', 401);

    if (req.method === 'GET') {
      return json({
        agent: { id: agent.id, name: agent.name, kind: agent.kind, permissions: agent.permissions },
        actions: [
          'list_delegations', 'start_run', 'update_run', 'add_artifact',
          'read_task', 'add_note', 'propose_task',
        ],
      });
    }

    if (req.method !== 'POST') return err('Method not allowed', 405);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== 'string') return err('Missing action');
    const { action } = body as { action: string };
    const has = (p: string) => (agent.permissions as string[]).includes(p);

    const logEvent = async (kind: string, entityType: string, entityId: string | null, entityTitle: string | null, payload: Record<string, unknown> = {}) => {
      await admin.from('events').insert({
        kind, actor_id: agent.actor_id, entity_type: entityType, entity_id: entityId, entity_title: entityTitle, payload,
      });
    };

    switch (action) {
      case 'list_delegations': {
        if (!has('read_delegations')) return err('Missing permission: read_delegations', 403);
        const { data, error } = await admin
          .from('delegations')
          .select('*, task:tasks(*), context:delegation_context(*)')
          .eq('agent_id', agent.id)
          .in('status', ['pending', 'in_progress'])
          .order('created_at');
        if (error) throw error;
        return json({ delegations: data ?? [] });
      }

      case 'start_run': {
        if (!has('write_runs')) return err('Missing permission: write_runs', 403);
        const delegationId = requiredStr(body.delegation_id, 64, 'delegation_id');
        const { data: delegation } = await admin
          .from('delegations')
          .select('id, agent_id, status')
          .eq('id', delegationId)
          .maybeSingle();
        if (!delegation || (delegation as { agent_id: string }).agent_id !== agent.id) {
          return err('Delegation not found for this agent', 404);
        }
        const input = body.input !== undefined && body.input !== null && typeof body.input === 'object' && !Array.isArray(body.input)
          ? body.input as Record<string, unknown>
          : {};
        const { data: run, error } = await admin
          .from('runs')
          .insert({
            delegation_id: delegationId,
            agent_id: agent.id,
            status: 'started',
            input,
          })
          .select('*')
          .single();
        if (error) throw error;
        await logEvent('run.started', 'run', (run as { id: string }).id, null, { delegation_id: delegationId });
        return json({ run });
      }

      case 'update_run': {
        if (!has('write_runs')) return err('Missing permission: write_runs', 403);
        const runId = requiredStr(body.run_id, 64, 'run_id');
        const status = body.status as string;
        if (!['running', 'succeeded', 'failed'].includes(status)) {
          return err('Invalid status (running|succeeded|failed)');
        }
        const { data: existing } = await admin
          .from('runs')
          .select('id, agent_id')
          .eq('id', runId)
          .maybeSingle();
        if (!existing || (existing as { agent_id: string }).agent_id !== agent.id) {
          return err('Run not found for this agent', 404);
        }
        const patch: Record<string, unknown> = { status };
        const summary = str(body.summary, MAX_TEXT);
        const errorText = str(body.error, MAX_TEXT);
        if (summary !== null) patch.summary = summary;
        if (errorText !== null) patch.error = errorText;
        if (status === 'succeeded' || status === 'failed') {
          patch.finished_at = new Date().toISOString();
          const { data: run } = await admin.from('runs').select('started_at').eq('id', runId).maybeSingle();
          if (run) {
            patch.duration_ms = Date.now() - new Date((run as { started_at: string }).started_at).getTime();
          }
        }
        const { data: run, error } = await admin
          .from('runs')
          .update(patch)
          .eq('id', runId)
          .select('*')
          .single();
        if (error) throw error;
        await logEvent(`run.status_${status}`, 'run', runId, summary !== null ? summary.slice(0, 80) : null);
        return json({ run });
      }

      case 'add_artifact': {
        if (!has('write_artifacts')) return err('Missing permission: write_artifacts', 403);
        const title = requiredStr(body.title, MAX_TITLE, 'title');
        const patch: Record<string, unknown> = {
          agent_id: agent.id,
          kind: (['text', 'code', 'url', 'file'].includes(body.kind) ? body.kind : 'text') as string,
          title,
          content_text: str(body.content_text, MAX_TEXT),
          url: str(body.url, 2048),
          run_id: str(body.run_id, 64),
          task_id: str(body.task_id, 64),
        };
        // Ownership validation: an artifact may only hang off this agent's own
        // run, or a task this agent has been delegated. project_id is
        // deliberately not accepted here — it cannot be scoped to the agent.
        if (patch.run_id) {
          const { data: run } = await admin.from('runs').select('id, agent_id').eq('id', patch.run_id as string).maybeSingle();
          if (!run || (run as { agent_id: string }).agent_id !== agent.id) return err('run_id not owned by this agent', 403);
        }
        if (patch.task_id) {
          const { data: link } = await admin
            .from('delegations')
            .select('task_id')
            .eq('agent_id', agent.id)
            .eq('task_id', patch.task_id as string)
            .maybeSingle();
          if (!link) return err('task_id is not part of this agent delegations', 403);
        }
        if (!patch.run_id && !patch.task_id) return err('add_artifact requires run_id or task_id');
        const { data: artifact, error } = await admin.from('artifacts').insert(patch).select('*').single();
        if (error) throw error;
        await logEvent('artifact.created', 'artifact', (artifact as { id: string }).id, title);
        return json({ artifact });
      }

      case 'read_task': {
        if (!has('read_tasks')) return err('Missing permission: read_tasks', 403);
        const taskId = requiredStr(body.task_id, 64, 'task_id');
        const { data: link } = await admin
          .from('delegations')
          .select('task_id')
          .eq('agent_id', agent.id)
          .eq('task_id', taskId)
          .maybeSingle();
        if (!link) return err('Task is not part of this agent delegations', 403);
        const { data: task, error } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle();
        if (error) throw error;
        return json({ task });
      }

      case 'add_note': {
        // Previously this action performed a write with no permission check at
        // all, so any authenticated agent token could write notes.
        if (!has('write_notes')) return err('Missing permission: write_notes', 403);
        const taskId = requiredStr(body.task_id, 64, 'task_id');
        const title = requiredStr(body.title, MAX_TITLE, 'title');
        const { data: link } = await admin
          .from('delegations')
          .select('task_id')
          .eq('agent_id', agent.id)
          .eq('task_id', taskId)
          .maybeSingle();
        if (!link) return err('Task is not part of this agent delegations', 403);
        const { data: note, error } = await admin
          .from('notes')
          .insert({ title, body_md: str(body.body_md, MAX_TEXT) ?? '', task_id: taskId, source: 'app' })
          .select('*')
          .single();
        if (error) throw error;
        await logEvent('note.created', 'note', (note as { id: string }).id, title, { by_agent: agent.name });
        return json({ note });
      }

      case 'propose_task': {
        if (!has('propose_task')) return err('Missing permission: propose_task', 403);
        const title = requiredStr(body.title, MAX_TITLE, 'title');
        const { data: task, error } = await admin
          .from('tasks')
          .insert({
            title,
            description: str(body.description, MAX_TEXT),
            priority: (['urgent', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal') as string,
            due_date: str(body.due_date, 10),
            origin: 'agent',
            status: 'backlog',
          })
          .select('*')
          .single();
        if (error) throw error;
        await logEvent('task.created', 'task', (task as { id: string }).id, title, { origin: 'agent', by_agent: agent.name });
        return json({ task });
      }

      default:
        return err(`Unknown action: ${action}`);
    }
  } catch (e) {
    // Validation failures carry a caller-safe message; everything else is opaque.
    if (e instanceof ValidationError) return err(e.message, 400);
    return dbErr(e, 'agent-api error');
  }
});
