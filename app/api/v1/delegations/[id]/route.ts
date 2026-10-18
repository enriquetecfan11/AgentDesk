import { HttpError, json, parseJson, requireUuid, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { addTaskComment } from '@/lib/domain/comments';
import { getDelegation, updateDelegationStatus } from '@/lib/domain/delegations';
import { delegationUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

async function requireOwnDelegation(request: Request, rawId: string) {
  const actor = await requireAgent(request, 'delegations:write');
  const id = requireUuid(rawId, 'Delegación no encontrada');

  const delegation = await getDelegation(id);
  if (!delegation) throw new HttpError(404, 'Delegación no encontrada');
  if (delegation.toAgentId !== actor.agentId) {
    throw new HttpError(403, 'Esta delegación no es para este agente');
  }

  return { actor, id, delegation };
}

/** GET /api/v1/delegations/:id */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'delegations:read');
    const id = requireUuid((await params).id, 'Delegación no encontrada');

    const delegation = await getDelegation(id);
    if (!delegation) throw new HttpError(404, 'Delegación no encontrada');
    if (delegation.toAgentId !== actor.agentId) {
      throw new HttpError(403, 'Esta delegación no es para este agente');
    }

    return json({ delegation });
  });
}

/**
 * PATCH /api/v1/delegations/:id
 *
 * `accepted` → `in_progress` → `completed` / `failed`. A `note` becomes a
 * comment on the linked task, which is how an agent explains itself where the
 * human will actually read it.
 */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const { actor, id, delegation } = await requireOwnDelegation(request, (await params).id);
    const input = await parseJson(request, delegationUpdateSchema);

    const updated = await updateDelegationStatus(id, { status: input.status });
    if (!updated) throw new HttpError(404, 'Delegación no encontrada');

    if (input.note && delegation.taskId) {
      await addTaskComment(delegation.taskId, agentActivityActor(actor), input.note);
    }

    await logActivity({
      actor: agentActivityActor(actor),
      action: `delegation.${input.status}`,
      entityType: 'delegation',
      entityId: id,
      meta: {
        title: updated.title,
        from: delegation.status,
        to: updated.status,
        taskId: updated.taskId,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    return json({ delegation: updated });
  });
}
