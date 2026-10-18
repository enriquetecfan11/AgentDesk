import { NextResponse } from 'next/server';
import { deleteAgentWithActor, getAgentActorId, updateAgentConfig } from '@/lib/agents-server';

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validId(id: string): boolean {
  return UUID.test(id);
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return failure('Invalid agent id', 400);

  let body: { status?: unknown; name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure('Invalid JSON body', 400);
  }

  const patch: { status?: 'active' | 'paused'; name?: string; description?: string | null } = {};
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'paused') {
      return failure('status must be active or paused', 400);
    }
    patch.status = body.status;
  }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string') return failure('name must be a string', 400);
    patch.name = body.name;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return failure('description must be a string or null', 400);
    }
    patch.description = body.description;
  }
  if (Object.keys(patch).length === 0) return failure('No valid fields to update', 400);

  try {
    await updateAgentConfig(params.id, patch);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (/required|exceeds|invalid status|no valid fields/.test(message)) return failure(message, 400);
    console.error('update agent failed', e);
    return failure('Failed to update agent', 500);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return failure('Invalid agent id', 400);
  try {
    const actorId = await getAgentActorId(params.id);
    await deleteAgentWithActor(params.id, actorId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message === 'agent not found') return failure('Agent not found', 404);
    console.error('delete agent failed', e);
    return failure('Failed to delete agent', 500);
  }
}