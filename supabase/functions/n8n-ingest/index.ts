/*
# n8n ingest webhook edge function

Incoming webhook for registered n8n automations. Each automation has a secret (generated in the
UI when registering the automation) stored hashed in `automations.secret_hash`. n8n calls:

  POST /functions/v1/n8n-ingest
  Header: X-N8N-Secret: <secret>
  Body: { action: "create_task" | "update_task", ...payload }

Actions:
- create_task: { title, description?, priority?, due_date?, project_name? }
- update_task: { task_id, status?, priority?, due_date? }
- list_tasks:  {} -> non-done tasks (so workflows can decide what to update)

Permission model: `automations.permissions` jsonb (create_task, update_task, read_tasks).
Every invocation is logged in `automations_log` and produces a timeline event attributed to the
automation's actor.

CORS: mandatory headers on every response including OPTIONS preflight.
*/

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-N8N-Secret',
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

interface AutomationRow {
  id: string;
  name: string;
  status: string;
  permissions: string[];
  actor_id: string | null;
  output_webhook_url: string | null;
}

async function authenticate(req: Request, admin: ReturnType<typeof createClient>): Promise<AutomationRow | null> {
  const secret = req.headers.get('X-N8N-Secret') ?? '';
  if (!secret) return null;
  const secretHash = await sha256Hex(secret);
  const { data } = await admin
    .from('automations')
    .select('id, name, status, permissions, actor_id, output_webhook_url')
    .eq('secret_hash', secretHash)
    .maybeSingle();
  if (!data) return null;
  if ((data as AutomationRow).status !== 'active') return null;
  return data as AutomationRow;
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

  let automation: AutomationRow | null = null;
  let action = 'unknown';
  let payload: Record<string, unknown> = {};
  let result: Record<string, unknown> = {};

  try {
    automation = await authenticate(req, admin);
    if (!automation) return err('Unauthorized: invalid or inactive automation secret', 401);

    if (req.method !== 'POST') return err('Method not allowed', 405);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== 'string') return err('Missing action');
    action = body.action;
    payload = body;
    const has = (p: string) => (automation!.permissions as string[]).includes(p);

    const logEvent = async (kind: string, entityType: string, entityId: string | null, entityTitle: string | null, p: Record<string, unknown> = {}) => {
      await admin.from('events').insert({
        kind, actor_id: automation!.actor_id, entity_type: entityType, entity_id: entityId, entity_title: entityTitle, payload: p,
      });
    };

    switch (action) {
      case 'create_task': {
        if (!has('create_task')) return err('Missing permission: create_task', 403);
        const title = body.title as string;
        if (!title) return err('Missing title');
        let projectId: string | null = null;
        if (typeof body.project_name === 'string' && body.project_name.trim()) {
          const { data: project } = await admin
            .from('projects')
            .select('id')
            .ilike('name', body.project_name.trim())
            .maybeSingle();
          projectId = project ? (project as { id: string }).id : null;
        }
        const { data: task, error } = await admin
          .from('tasks')
          .insert({
            title,
            description: (body.description as string) ?? null,
            priority: (['urgent', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal') as string,
            due_date: (body.due_date as string) ?? null,
            project_id: projectId,
            origin: 'automation',
            status: 'backlog',
          })
          .select('*')
          .single();
        if (error) throw error;
        result = { task };
        await logEvent('task.created', 'task', (task as { id: string }).id, title, { origin: 'automation', by: automation.name });
        break;
      }

      case 'update_task': {
        if (!has('update_task')) return err('Missing permission: update_task', 403);
        const taskId = body.task_id as string;
        if (!taskId) return err('Missing task_id');
        const patch: Record<string, unknown> = {};
        if (['backlog', 'in_progress', 'review', 'done'].includes(body.status)) {
          patch.status = body.status;
          if (body.status === 'done') patch.completed_at = new Date().toISOString();
        }
        if (['urgent', 'high', 'normal', 'low'].includes(body.priority)) patch.priority = body.priority;
        if (typeof body.due_date === 'string') patch.due_date = body.due_date;
        if (Object.keys(patch).length === 0) return err('No valid fields to update');
        const { data: task, error } = await admin
          .from('tasks')
          .update(patch)
          .eq('id', taskId)
          .select('*')
          .single();
        if (error) throw error;
        result = { task };
        await logEvent(`task.status_${body.status ?? 'updated'}`, 'task', taskId, (task as { title: string }).title, { by: automation.name });
        break;
      }

      case 'list_tasks': {
        if (!has('read_tasks')) return err('Missing permission: read_tasks', 403);
        const { data: tasks, error } = await admin
          .from('tasks')
          .select('id, title, status, priority, due_date, project_id, origin')
          .neq('status', 'done')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        result = { tasks: tasks ?? [] };
        break;
      }

      default:
        return err(`Unknown action: ${action}`);
    }

    await admin.from('automations_log').insert({
      automation_id: automation.id,
      action,
      payload,
      result,
    });

    // Optional outbound trigger: notify the automation's output webhook (fire and forget)
    if (automation.output_webhook_url) {
      try {
        await fetch(automation.output_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'automation_invoked', action, result }),
        });
      } catch (webhookError) {
        console.error('output webhook failed', webhookError);
      }
    }

    return json(result);
  } catch (e) {
    console.error('n8n-ingest error', e);
    return err(e instanceof Error ? e.message : 'Internal error', 500);
  }
});
