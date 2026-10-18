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
      {/* First thing in the tab order: jumps past the sidebar straight to the
          page, which is the point of a skip link on a navigation-heavy app. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        Saltar al contenido
      </a>
      <AppSidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        {/* tabIndex={-1} so the skip link can actually move the focus here. */}
        <main id="contenido" tabIndex={-1} className="flex-1 overflow-y-auto focus:outline-none">
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
