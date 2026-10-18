import { json, parseJson, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { createDelegation, listDelegations } from '@/lib/domain/delegations';
import type { DelegationStatusValue } from '@/lib/constants';
import { DELEGATION_STATUSES } from '@/lib/constants';
import { delegationCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/delegations
 *
 * An agent sees the delegations addressed to it. `?actionable=true` narrows
 * them down to the ones it may actually start (pending or in progress, and not
 * held back by an approval gate).
 */
export async function GET(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'delegations:read');
    const params = new URL(request.url).searchParams;

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
        agentId: actor.agentId,
        statuses: statuses && statuses.length > 0 ? statuses : undefined,
        actionableOnly: params.get('actionable') === 'true',
      }),
    });
  });
}

/**
 * POST /api/v1/delegations
 *
 * Agents delegate to each other. The origin is always the authenticated agent,
 * never a value taken from the body.
 */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'delegations:write');
    const input = await parseJson(request, delegationCreateSchema);

    const delegation = await createDelegation(input, agentActivityActor(actor));

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'delegation.created',
      entityType: 'delegation',
      entityId: delegation.id,
      meta: {
        title: delegation.title,
        toAgentId: delegation.toAgentId,
        taskId: delegation.taskId,
        via: 'api',
      },
    });

    return json({ delegation }, { status: 201 });
  });
}
