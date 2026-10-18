import { HttpError, json, parseJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { decideApproval, getApproval } from '@/lib/domain/approvals';
import { approvalDecisionSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/approvals/:id */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Aprobación no encontrada');

    const approval = await getApproval(id);
    if (!approval) throw new HttpError(404, 'Aprobación no encontrada');

    return json({ approval });
  });
}

/**
 * PATCH /api/approvals/:id — the decision.
 *
 * `{ action: 'approve' | 'reject' | 'cancel', payload?, reason? }`.
 *
 * Only reachable with a session cookie, which is how "an agent never approves
 * its own work" is enforced: there is no path to this handler that carries an
 * agent token, and `decideApproval` takes a user rather than an actor.
 *
 * A second decision on the same approval answers `409` with the state that
 * actually holds — including the case where the deadline passed while the
 * dialog was open. Fail closed applies to the person too: an approval that
 * lapsed cannot be rescued by clicking anyway.
 */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Aprobación no encontrada');
    const input = await parseJson(request, approvalDecisionSchema);

    const outcome = await decideApproval(id, { id: user.id, name: user.name }, input);

    if (!outcome.ok) {
      if (outcome.reason === 'not_found') throw new HttpError(404, 'Aprobación no encontrada');

      throw new HttpError(
        409,
        outcome.approval.status === 'expired'
          ? 'La aprobación había caducado: cuenta como rechazada y no se puede cambiar'
          : `Ya estaba decidida (${outcome.approval.status}) y una decisión no se sobrescribe`,
        { approval: outcome.approval },
      );
    }

    const { approval, delegation } = outcome;

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: `approval.${approval.status}`,
      entityType: 'approval',
      entityId: approval.id,
      meta: {
        taskId: approval.taskId,
        agentId: approval.agentId,
        tool: approval.tool,
        risk: approval.risk,
        title: approval.title,
        // Says whether you changed what you were approving, which is the one
        // thing a timeline reader cannot reconstruct afterwards.
        edited: approval.payloadEdited !== null,
        reason: approval.reason,
        delegationId: delegation?.id ?? null,
      },
    });

    return json({ approval, delegation });
  });
}
