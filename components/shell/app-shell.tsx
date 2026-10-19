'use client';

import { useEffect, useState } from 'react';

import {
  AppSidebar,
  MobileSidebar,
  type NavBadges,
  type SidebarState,
} from '@/components/shell/app-sidebar';
import { Topbar } from '@/components/shell/topbar';
import { useMediaQuery } from '@/hooks/use-media-query';

/** Where the user's preferred sidebar shape is remembered between visits. */
const STORAGE_KEY = 'agentdesk.sidebar';

/** Tablet band: a collapsed sidebar is the sane default there. */
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1199.98px)';

function isSidebarState(value: string | null): value is SidebarState {
  return value === 'expanded' || value === 'collapsed' || value === 'hidden';
}

/**
 * The structural shell every authenticated page renders inside.
 *
 * It owns one piece of state — the sidebar shape — and renders the three
 * things that depend on it: the sidebar itself, the header that can toggle it,
 * and the phone drawer. Pages never touch any of this; they only provide their
 * content, which is what makes the whole app behave the same way on every
 * screen size instead of each page reinventing its own breakpoints.
 *
 * Layout contract:
 *  - the root is a full-height flex row that never scrolls, so no horizontal
 *    scroll can leak out of a page;
 *  - the sidebar is a flex sibling, so collapsing it hands the width straight
 *    to the content with no measurement needed;
 *  - `main` is the single vertical scroller.
 */
export function AppShell({
  user,
  badges,
  children,
}: {
  user: { name: string; email: string };
  badges?: NavBadges;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<SidebarState>('expanded');
  const [ready, setReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // Restore the remembered shape. With no preference stored, a tablet starts
  // collapsed and everything wider starts expanded.
  useEffect(() => {
    let stored: SidebarState | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (isSidebarState(raw)) stored = raw;
    } catch {
      // Private mode or a blocked store: the defaults below still apply.
    }

    setState(stored ?? (window.matchMedia(TABLET_QUERY).matches ? 'collapsed' : 'expanded'));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, state);
    } catch {
      // Non-fatal: the preference simply is not remembered.
    }
  }, [ready, state]);

  // Growing past the phone breakpoint must not leave the drawer hanging open.
  useEffect(() => {
    if (isDesktop) setDrawerOpen(false);
  }, [isDesktop]);

  function toggle() {
    setState((current) => (current === 'expanded' ? 'collapsed' : 'expanded'));
  }

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

      <AppSidebar user={user} badges={badges} state={state} onHide={() => setState('hidden')} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          sidebarState={state}
          onToggleSidebar={toggle}
          onOpenMobile={() => setDrawerOpen(true)}
        />
        {/* tabIndex={-1} so the skip link can actually move the focus here. */}
        <main
          id="contenido"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden focus:outline-none"
        >
          {children}
        </main>
      </div>

      <MobileSidebar
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        user={user}
        badges={badges}
      />
    </div>
  );
}
