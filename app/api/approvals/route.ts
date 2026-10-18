import { json, requireApiUser, route } from '@/lib/api/http';
import { APPROVAL_STATUSES, type ApprovalStatusValue } from '@/lib/constants';
import { listApprovals } from '@/lib/domain/approvals';
import { releaseExpiredLeases } from '@/lib/domain/claims';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/approvals?status=pending,rejected&taskId=…&agentId=…
 *
 * The inbox. Reading it also sweeps: overdue approvals are flipped to
 * `expired` (inside `listApprovals`) and tasks whose holder went quiet go back
 * in the queue. Doing it on read rather than on a timer means the screen is
 * correct for whoever just opened it, which is the only moment that matters —
 * and it saves the app a scheduler it does not otherwise need.
 *
 * Malformed filter values are dropped rather than rejected, the same rule the
 * task filters follow: an old bookmark should still show something useful.
 */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();

    const params = new URL(request.url).searchParams;

    const statuses = params
      .get('status')
      ?.split(',')
      .map((value) => value.trim())
      .filter((value): value is ApprovalStatusValue =>
        (APPROVAL_STATUSES as readonly string[]).includes(value),
      );

    const [approvals] = await Promise.all([
      listApprovals({
        statuses: statuses?.length ? statuses : undefined,
        taskId: params.get('taskId') ?? undefined,
        agentId: params.get('agentId') ?? undefined,
      }),
      releaseExpiredLeases(),
    ]);

    return json({ approvals });
  });
}
