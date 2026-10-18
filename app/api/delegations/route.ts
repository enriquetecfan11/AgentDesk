import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { DELEGATION_STATUSES, type DelegationStatusValue } from '@/lib/constants';
import { logActivity } from '@/lib/domain/activity';
import { createDelegation, listDelegations } from '@/lib/domain/delegations';
import { delegationCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/delegations?agentId=…&taskId=…&status=pending */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();
    const params = new URL(request.url).searchParams;

    const agentId = params.get('agentId') ?? undefined;
    const taskId = params.get('taskId') ?? undefined;

    const requested = params.get('status');
    const statuses = requested
      ? (requested
          .split(',')
          .map((value) => value.trim())
          .filter((value): value is DelegationStatusValue =>
            (DELEGATION_STATUSES as readonly string[]).includes(value),
          ) as DelegationStatusValue[])
      : undefined;

    return json({
      delegations: await listDelegations({
        agentId,
        taskId,
        statuses: statuses && statuses.length > 0 ? statuses : undefined,
      }),
    });
  });
}

/** POST /api/delegations — hand work to an agent. */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, delegationCreateSchema);

    const delegation = await createDelegation(input, {
      type: 'human',
      id: user.id,
      name: user.name,
    });

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'delegation.created',
      entityType: 'delegation',
      entityId: delegation.id,
      meta: {
        title: delegation.title,
        toAgentId: delegation.toAgentId,
        taskId: delegation.taskId,
        requiresApproval: delegation.requiresApproval,
      },
    });

    return json({ delegation }, { status: 201 });
  });
}
