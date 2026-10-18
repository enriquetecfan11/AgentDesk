import { NextResponse } from 'next/server';
import { createAgentWithActor } from '@/lib/agents-server';
import type { AgentKind } from '@/lib/types';

const KINDS: AgentKind[] = ['organizer', 'executor', 'analyst'];

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Create an agent and return its token exactly once.
 *
 * Runs server-side because it needs the service role key. `anon` can no longer
 * insert into `agents` (see migration 20261018120000), so this route is the
 * only way an agent row gets created.
 */
export async function POST(request: Request) {
  let body: { name?: unknown; description?: unknown; kind?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure('Invalid JSON body', 400);
  }

  if (typeof body.name !== 'string') return failure('name is required', 400);
  if (body.description !== null && body.description !== undefined && typeof body.description !== 'string') {
    return failure('description must be a string', 400);
  }
  if (typeof body.kind !== 'string' || !KINDS.includes(body.kind as AgentKind)) {
    return failure(`kind must be one of: ${KINDS.join(', ')}`, 400);
  }

  try {
    const result = await createAgentWithActor({
      name: body.name,
      description: (body.description as string | null | undefined) ?? null,
      kind: body.kind as AgentKind,
    });
    return NextResponse.json(
      { agentId: result.agentId, actorId: result.actorId, token: result.token, tokenPrefix: result.tokenPrefix },
      { status: 201 },
    );
  } catch (e) {
    // Validation errors are safe to surface; anything else is logged, not returned.
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (/required|exceeds/.test(message)) return failure(message, 400);
    console.error('create agent failed', e);
    return failure('Failed to create agent', 500);
  }
}