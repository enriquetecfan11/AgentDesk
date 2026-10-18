import { json, requireApiUser, route } from '@/lib/api/http';
import { RUN_STATUSES, type RunStatusValue } from '@/lib/constants';
import { listRuns } from '@/lib/domain/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/runs?agentId=…&status=running&taskId=… */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();
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
        agentId: params.get('agentId') ?? undefined,
        taskId: params.get('taskId') ?? undefined,
        statuses: statuses && statuses.length > 0 ? statuses : undefined,
      }),
    });
  });
}
