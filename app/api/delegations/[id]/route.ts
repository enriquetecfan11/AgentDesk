import { HttpError, json, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { addTaskComment } from '@/lib/domain/comments';
import { getDelegation, updateDelegationStatus } from '@/lib/domain/delegations';
import { delegationReviewSchema, delegationUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * PATCH /api/delegations/:id
 *
 * Two shapes, because two different people use it:
 *   - `{ action: "approve" | "cancel" }` — the human clearing an approval gate.
 *   - `{ status, note? }` — an agent reporting progress, which also lets it
 *     leave a note on the task the delegation points at.
 */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Delegación no encontrada');

    const before = await getDelegation(id);
    if (!before) throw new HttpError(404, 'Delegación no encontrada');

    const raw = await request.json();

    const review = delegationReviewSchema.safeParse(raw);

    if (review.success) {
      const approve = review.data.action === 'approve';

      const delegation = await updateDelegationStatus(id, {
        status: approve ? 'pending' : 'cancelled',
        approve,
      });

      if (!delegation) throw new HttpError(404, 'Delegación no encontrada');

      await logActivity({
        actor: { type: 'human', id: user.id, name: user.name },
        action: approve ? 'delegation.approved' : 'delegation.cancelled',
        entityType: 'delegation',
        entityId: id,
        meta: { title: delegation.title, toAgentId: delegation.toAgentId },
      });

      return json({ delegation });
    }

    const parsed = delegationUpdateSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(422, 'Datos inválidos', parsed.error.issues);

    const delegation = await updateDelegationStatus(id, { status: parsed.data.status });
    if (!delegation) throw new HttpError(404, 'Delegación no encontrada');

    if (parsed.data.note && delegation.taskId) {
      await addTaskComment(
        delegation.taskId,
        { type: 'human', id: user.id, name: user.name },
        parsed.data.note,
      );
    }

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: `delegation.${parsed.data.status}`,
      entityType: 'delegation',
      entityId: id,
      meta: { title: delegation.title, from: before.status, to: delegation.status },
    });

    return json({ delegation });
  });
}

/** GET /api/delegations/:id */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Delegación no encontrada');

    const delegation = await getDelegation(id);
    if (!delegation) throw new HttpError(404, 'Delegación no encontrada');

    return json({ delegation });
  });
}
