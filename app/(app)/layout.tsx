import { AppCommands } from '@/components/shell/app-commands';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { LiveUpdates } from '@/components/shell/live-updates';
import { Topbar } from '@/components/shell/topbar';
import { requireUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell. Every route under (app) is behind this layout, which is
 * the single place where a session is demanded.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex h-dvh overflow-hidden">
      <AppSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main id="contenido" className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Keyboard shortcuts and the command palette live above every page. */}
      <AppCommands />
      {/* Live channel: tasks, runs and the timeline, pushed from the server. */}
      <LiveUpdates />
    </div>
  );
}
