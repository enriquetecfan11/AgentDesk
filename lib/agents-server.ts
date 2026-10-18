import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { AgentKind } from '@/lib/types';

const MAX_NAME = 120;
const MAX_DESCRIPTION = 2000;

/**
 * Credentials and privileged writes live here, never in the browser.
 *
 * `import 'server-only'` makes the bundler fail loudly if this module is ever
 * pulled into a client component, which is what previously happened: lib/api.ts
 * imported it and 17 'use client' views imported lib/api.ts, so agent creation
 * ran in the browser where SUPABASE_SERVICE_ROLE_KEY is undefined and threw
 * 'service role key unavailable'. Everything here is reached through the route
 * handlers in app/api/**.
 */
const AGENT_PERMISSIONS = [
  'read_delegations', 'write_runs', 'write_artifacts', 'write_notes', 'read_tasks',
];

const AUTOMATION_PERMISSIONS = ['create_task', 'update_task', 'read_tasks'];

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('supabase url unavailable');
  if (!serviceKey) throw new Error('service role key unavailable');
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function required(value: string, max: number, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required`);
  if (trimmed.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return trimmed;
}

function optional(value: string | null | undefined, max: number, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value.length > max) throw new Error(`${field} exceeds ${max} characters`);
  return value;
}

export async function createAgentWithActor(input: {
  name: string; description: string | null; kind: AgentKind;
}): Promise<{ agentId: string; actorId: string; token: string; tokenPrefix: string }> {
  const name = required(input.name, MAX_NAME, 'name');
  const description = optional(input.description, MAX_DESCRIPTION, 'description');

  // Per-agent color from a stable palette
  const palette = ['#d97706', '#3b82f6', '#14b8a6', '#ef4444', '#84cc16', '#ec4899'];
  const color = palette[Math.floor(Math.random() * palette.length)];

  const db = admin();
  const { data: actor, error: actorError } = await db
    .from('actors')
    .insert({ kind: 'agent', name, display_name: name, color })
    .select('id')
    .single();
  if (actorError) throw actorError;

  // The plaintext token exists only in this function's scope and is returned to
  // the caller exactly once. Only its sha256 is ever persisted.
  const token = generateToken();
  const tokenHash = await sha256(token);
  const tokenPrefix = token.slice(0, 8);

  const { data: agent, error: agentError } = await db
    .from('agents')
    .insert({
      name,
      description,
      kind: input.kind,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      actor_id: actor.id,
      status: 'active',
      permissions: AGENT_PERMISSIONS,
    })
    .select('id')
    .single();
  if (agentError) {
    // Do not leave an orphan actor row behind.
    await db.from('actors').delete().eq('id', actor.id);
    throw agentError;
  }

  await db.from('events').insert({
    kind: 'agent.registered',
    actor_id: actor.id,
    entity_type: 'agent',
    entity_id: agent.id,
    entity_title: name,
    payload: { kind: input.kind, token_prefix: tokenPrefix },
  });

  return { agentId: agent.id, actorId: actor.id, token, tokenPrefix };
}

/** Resolves an agent's actor id so the delete route does not need the service role itself. */
export async function getAgentActorId(agentId: string): Promise<string | null> {
  const db = admin();
  const { data, error } = await db.from('agents').select('actor_id').eq('id', agentId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('agent not found');
  return (data as { actor_id: string | null }).actor_id ?? null;
}

export async function deleteAgentWithActor(agentId: string, actorId: string | null): Promise<void> {
  const db = admin();
  const { error: agentError } = await db.from('agents').delete().eq('id', agentId);
  if (agentError) throw agentError;
  if (actorId) {
    await db.from('actors').delete().eq('id', actorId);
  }
}

export async function updateAgentConfig(agentId: string, patch: {
  status?: 'active' | 'paused'; name?: string; description?: string | null;
}): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'paused') throw new Error('invalid status');
    clean.status = patch.status;
  }
  if (patch.name !== undefined) clean.name = required(patch.name, MAX_NAME, 'name');
  if (patch.description !== undefined) {
    clean.description = optional(patch.description, MAX_DESCRIPTION, 'description');
  }
  if (Object.keys(clean).length === 0) throw new Error('no valid fields to update');

  const db = admin();
  const { error } = await db.from('agents').update(clean).eq('id', agentId);
  if (error) throw error;
}

function generateToken(): string {
  // 192 bits of CSPRNG entropy, hex encoded.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'agt_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(): string {
  // 160 bits of CSPRNG entropy, hex encoded.
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return 'n8n_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createAutomationWithSecret(input: {
  name: string; description: string | null; permissions?: string[];
}): Promise<{ automationId: string; actorId: string; secret: string }> {
  const name = required(input.name, MAX_NAME, 'name');
  const description = optional(input.description, MAX_DESCRIPTION, 'description');

  // Do not trust a caller-supplied permission list: intersect it with the known
  // set so a crafted request cannot mint an automation with arbitrary powers.
  const requested = input.permissions ?? AUTOMATION_PERMISSIONS;
  const permissions = AUTOMATION_PERMISSIONS.filter((p) => requested.includes(p));
  if (permissions.length === 0) throw new Error('no valid permissions requested');

  const db = admin();
  const { data: actor, error: actorError } = await db
    .from('actors')
    .insert({ kind: 'automation', name, display_name: name, color: '#3b82f6' })
    .select('id')
    .single();
  if (actorError) throw actorError;

  // Plaintext secret is returned once; only sha256 is persisted.
  const secret = generateSecret();
  const secretHash = await sha256(secret);

  const { data: automation, error: automationError } = await db
    .from('automations')
    .insert({
      name,
      description,
      permissions,
      secret_hash: secretHash,
      secret_prefix: secret.slice(0, 8),
      actor_id: actor.id,
      status: 'active',
    })
    .select('id')
    .single();
  if (automationError) {
    await db.from('actors').delete().eq('id', actor.id);
    throw automationError;
  }

  await db.from('events').insert({
    kind: 'automation.registered',
    actor_id: actor.id,
    entity_type: 'automation',
    entity_id: automation.id,
    entity_title: name,
    payload: { secret_prefix: secret.slice(0, 8) },
  });

  return { automationId: automation.id, actorId: actor.id, secret };
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}