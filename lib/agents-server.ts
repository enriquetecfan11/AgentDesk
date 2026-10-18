import { createClient } from '@supabase/supabase-js';
import type { AgentKind } from '@/lib/types';

export async function createAgentWithActor(input: {
  name: string; description: string | null; kind: AgentKind;
}): Promise<{ agentId: string; actorId: string; token: string; tokenPrefix: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!serviceKey) throw new Error('service role key unavailable');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Per-agent color from a stable palette
  const palette = ['#d97706', '#3b82f6', '#14b8a6', '#ef4444', '#84cc16', '#ec4899'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  const { data: actor, error: actorError } = await admin
    .from('actors')
    .insert({ kind: 'agent', name: input.name, display_name: input.name, color })
    .select('id')
    .single();
  if (actorError) throw actorError;

  const token = generateToken();
  const tokenHash = await sha256(token);
  const tokenPrefix = token.slice(0, 8);

  const { data: agent, error: agentError } = await admin
    .from('agents')
    .insert({
      name: input.name,
      description: input.description,
      kind: input.kind,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      actor_id: actor.id,
      status: 'active',
      permissions: ['read_delegations', 'write_runs', 'write_artifacts', 'read_tasks'],
    })
    .select('id')
    .single();
  if (agentError) throw agentError;

  await admin.from('events').insert({
    kind: 'agent.registered',
    actor_id: actor.id,
    entity_type: 'agent',
    entity_id: agent.id,
    entity_title: input.name,
    payload: { kind: input.kind, token_prefix: tokenPrefix },
  });

  return { agentId: agent.id, actorId: actor.id, token, tokenPrefix };
}

export async function deleteAgentWithActor(agentId: string, actorId: string | null): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!serviceKey) throw new Error('service role key unavailable');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: agentError } = await admin.from('agents').delete().eq('id', agentId);
  if (agentError) throw agentError;
  if (actorId) {
    await admin.from('actors').delete().eq('id', actorId);
  }
}

export async function updateAgentConfig(agentId: string, patch: {
  status?: 'active' | 'paused'; name?: string; description?: string | null;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!serviceKey) throw new Error('service role key unavailable');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.from('agents').update(patch).eq('id', agentId);
  if (error) throw error;
}

function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'agt_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return 'n8n_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createAutomationWithSecret(input: {
  name: string; description: string | null; permissions?: string[];
}): Promise<{ automationId: string; actorId: string; secret: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  if (!serviceKey) throw new Error('service role key unavailable');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: actor, error: actorError } = await admin
    .from('actors')
    .insert({ kind: 'automation', name: input.name, display_name: input.name, color: '#3b82f6' })
    .select('id')
    .single();
  if (actorError) throw actorError;

  const secret = generateSecret();
  const secretHash = await sha256(secret);

  const { data: automation, error: automationError } = await admin
    .from('automations')
    .insert({
      name: input.name,
      description: input.description,
      permissions: input.permissions ?? ['create_task', 'update_task', 'read_tasks'],
      secret_hash: secretHash,
      secret_prefix: secret.slice(0, 8),
      actor_id: actor.id,
      status: 'active',
    })
    .select('id')
    .single();
  if (automationError) throw automationError;

  await admin.from('events').insert({
    kind: 'automation.registered',
    actor_id: actor.id,
    entity_type: 'automation',
    entity_id: automation.id,
    entity_title: input.name,
    payload: { secret_prefix: secret.slice(0, 8) },
  });

  return { automationId: automation.id, actorId: actor.id, secret };
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}
