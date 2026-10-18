import { json, parseJson, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { RUN_STATUSES, type RunStatusValue } from '@/lib/constants';
import { logActivity } from '@/lib/domain/activity';
import { createRun, listRuns } from '@/lib/domain/runs';
import { runCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/runs?status=running,failed&taskId=… */
export async function GET(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:read');
    const params = new URL(request.url).searchParams;

    const requested = params.get('status');
    const statuses = requested
      ? (requested
          .split(',')
          .map((value) => value.trim())
          .filter((value): value is RunStatusValue =>
            (RUN_STATUSES as readonly string[]).includes(value),
          ) as RunStatusValue[])
      : undefined;

    return json({
      runs: await listRuns({
        agentId: actor.agentId,
        taskId: params.get('taskId') ?? undefined,
        delegationId: params.get('delegationId') ?? undefined,
        statuses: statuses && statuses.length > 0 ? statuses : undefined,
      }),
    });
  });
}

/**
 * POST /api/v1/runs
 *
 * The agent is always the authenticated one: `agentId` in the body is ignored
 * so a token can only ever open runs in its own name.
 */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'runs:write');
    const input = await parseJson(request, runCreateSchema);

    const run = await createRun({
      agentId: actor.agentId,
      taskId: input.taskId ?? null,
      delegationId: input.delegationId ?? null,
      input: input.input ?? null,
      status: input.status,
    });

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'run.started',
      entityType: 'run',
      entityId: run.id,
      meta: { taskId: run.taskId, delegationId: run.delegationId, via: 'api' },
    });

    return json({ run }, { status: 201 });
  });
}
