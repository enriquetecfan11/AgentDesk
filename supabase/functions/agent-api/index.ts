/*
# Agent API edge function

Server-side API for AI agents (organizer/executor/analyst) to operate on the workspace.

Authentication: `Authorization: Bearer <agent token>` where the token was generated at agent
registration (shown once in the UI). Tokens are stored as sha256 hashes in `agents.token_hash`.
A lookup table `agent_token_lookup` maps token_hash -> agent_id for O(1) validation.

Routes (all POST unless noted):
- GET  /agent-api           -> identity: agent name, kind, permissions
- POST /agent-api           -> route dispatcher via { action, ...payload }
Actions:
- list_delegations          -> pending/in_progress delegations for this agent (with task + context)
- start_run                 -> { delegation_id, input? } creates a run (status started)
- update_run                -> { run_id, status, summary?, error?, finished? } updates own run
- add_artifact              -> { run_id?, task_id?, kind, title, content_text?, url? }
- read_task                 -> { task_id } read a task's full detail (own delegations only)
- add_note                  -> { task_id, title, body_md }
- propose_task              -> { title, description?, priority?, due_date? } creates a task in Inbox
                                with origin=agent and a delegation? no — plain task, origin agent.

Permission model (agents.permissions jsonb):
- read_delegations, write_runs, write_artifacts, read_tasks, propose_task

CORS: mandatory headers on every response including OPTIONS preflight.
*/

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
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

async function authenticate(req: Request, admin: ReturnType<typeof createClient>): Promise<AgentRow | null> {
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const agent = await authenticate(req, admin);
    if (!agent) return err('Unauthorized: invalid or inactive agent token', 401);

    const url = new URL(req.url);

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
        const delegationId = body.delegation_id as string;
        if (!delegationId) return err('Missing delegation_id');
        const { data: delegation } = await admin
          .from('delegations')
          .select('id, agent_id, status')
          .eq('id', delegationId)
          .maybeSingle();
        if (!delegation || (delegation as { agent_id: string }).agent_id !== agent.id) {
          return err('Delegation not found for this agent', 404);
        }
        const { data: run, error } = await admin
          .from('runs')
          .insert({
            delegation_id: delegationId,
            agent_id: agent.id,
            status: 'started',
            input: (body.input as Record<string, unknown>) ?? {},
          })
          .select('*')
          .single();
        if (error) throw error;
        await logEvent('run.started', 'run', (run as { id: string }).id, null, { delegation_id: delegationId });
        return json({ run });
      }

      case 'update_run': {
        if (!has('write_runs')) return err('Missing permission: write_runs', 403);
        const runId = body.run_id as string;
        const status = body.status as string;
        if (!runId || !['running', 'succeeded', 'failed'].includes(status)) {
          return err('Missing run_id or invalid status (running|succeeded|failed)');
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
        if (typeof body.summary === 'string') patch.summary = body.summary;
        if (typeof body.error === 'string') patch.error = body.error;
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
        await logEvent(`run.status_${status}`, 'run', runId, typeof body.summary === 'string' ? body.summary.slice(0, 80) : null);
        return json({ run });
      }

      case 'add_artifact': {
        if (!has('write_artifacts')) return err('Missing permission: write_artifacts', 403);
        const title = body.title as string;
        if (!title) return err('Missing title');
        const patch: Record<string, unknown> = {
          agent_id: agent.id,
          kind: (['text', 'code', 'url', 'file'].includes(body.kind) ? body.kind : 'text') as string,
          title,
          content_text: (body.content_text as string) ?? null,
          url: (body.url as string) ?? null,
          run_id: (body.run_id as string) ?? null,
          task_id: (body.task_id as string) ?? null,
          project_id: (body.project_id as string) ?? null,
        };
        // SECURITY: server-side ownership validation of run_id / task_id / project_id refs
        if (patch.run_id) {
          const { data: run } = await admin.from('runs').select('id, agent_id').eq('id', patch.run_id as string).maybeSingle();
          if (!run || (run as { agent_id: string }).agent_id !== agent.id) return err('run_id not owned by this agent', 403);
        }
        if (patch.task_id) {
          const { data: task } = await admin
            .from('delegations')
            .select('task_id')
            .eq('agent_id', agent.id)
            .eq('task_id', patch.task_id as string)
            .maybeSingle();
          if (!task) return err('task_id is not part of this agent delegations', 403);
        }
        const { data: artifact, error } = await admin.from('artifacts').insert(patch).select('*').single();
        if (error) throw error;
        await logEvent('artifact.created', 'artifact', (artifact as { id: string }).id, title);
        return json({ artifact });
      }

      case 'read_task': {
        if (!has('read_tasks')) return err('Missing permission: read_tasks', 403);
        const taskId = body.task_id as string;
        if (!taskId) return err('Missing task_id');
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
        const taskId = body.task_id as string;
        const title = body.title as string;
        if (!taskId || !title) return err('Missing task_id or title');
        const { data: link } = await admin
          .from('delegations')
          .select('task_id')
          .eq('agent_id', agent.id)
          .eq('task_id', taskId)
          .maybeSingle();
        if (!link) return err('Task is not part of this agent delegations', 403);
        const { data: note, error } = await admin
          .from('notes')
          .insert({ title, body_md: (body.body_md as string) ?? '', task_id: taskId, source: 'app' })
          .select('*')
          .single();
        if (error) throw error;
        await logEvent('note.created', 'note', (note as { id: string }).id, title, { by_agent: agent.name });
        return json({ note });
      }

      case 'propose_task': {
        if (!has('propose_task')) return err('Missing permission: propose_task', 403);
        const title = body.title as string;
        if (!title) return err('Missing title');
        const { data: task, error } = await admin
          .from('tasks')
          .insert({
            title,
            description: (body.description as string) ?? null,
            priority: (['urgent', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal') as string,
            due_date: (body.due_date as string) ?? null,
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
    console.error('agent-api error', e);
    return err(e instanceof Error ? e.message : 'Internal error', 500);
  }
});
