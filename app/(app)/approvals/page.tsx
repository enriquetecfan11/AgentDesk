import { ApprovalsWorkspace } from '@/components/approvals/approvals-workspace';
import { listApprovals } from '@/lib/domain/approvals';
import { releaseExpiredLeases } from '@/lib/domain/claims';

export const dynamic = 'force-dynamic';

/**
 * The approvals inbox.
 *
 * Both sweeps run on load — overdue approvals become `expired`, tasks whose
 * holder went quiet go back to the queue — so what you see is the state as of
 * this render rather than as of the last time something happened to write it.
 */
export default async function ApprovalsPage() {
  const [approvals] = await Promise.all([listApprovals({ limit: 200 }), releaseExpiredLeases()]);

  return <ApprovalsWorkspace initialApprovals={approvals} />;
}
