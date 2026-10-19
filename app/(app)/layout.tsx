import { AppCommands } from '@/components/shell/app-commands';
import { AppShell } from '@/components/shell/app-shell';
import { LiveUpdates } from '@/components/shell/live-updates';
import { requireUser } from '@/lib/auth/session';
import { countPendingApprovals } from '@/lib/domain/approvals';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell. Every route under (app) is behind this layout, which is
 * the single place where a session is demanded. The structure itself — sidebar,
 * header and the responsive behaviour shared by all of them — lives in
 * `AppShell`; this layout only resolves the session and the badge count.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // The sidebar is a Client Component, so the badge count is read here and
  // passed down. Every page under (app) is already `force-dynamic`, so this
  // adds one count query per navigation, not a cache to invalidate.
  const pendingApprovals = await countPendingApprovals();

  return (
    <>
      <AppShell user={user} badges={{ approvals: pendingApprovals }}>
        {children}
      </AppShell>

      {/* Keyboard shortcuts and the command palette live above every page. */}
      <AppCommands />
      {/* Live channel: tasks, runs and the timeline, pushed from the server. */}
      <LiveUpdates />
    </>
  );
}
