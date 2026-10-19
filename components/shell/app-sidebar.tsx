'use client';

import {
  Activity,
  Bot,
  CalendarDays,
  CalendarCheck,
  FolderKanban,
  Inbox,
  ListChecks,
  LogOut,
  NotebookPen,
  PanelLeft,
  PlayCircle,
  Settings,
  ShieldCheck,
  SquareKanban,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * The three shapes the sidebar can take on a pointer-sized screen.
 *
 *  - `expanded`: icons, section names and the user profile.
 *  - `collapsed`: icons only, with hover tooltips.
 *  - `hidden`: out of the way entirely, leaving the content the whole width.
 *
 * On phones the sidebar is never one of these: navigation moves into a drawer
 * (`MobileSidebar`) and the three states only apply from `md` upwards.
 */
export type SidebarState = 'expanded' | 'collapsed' | 'hidden';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase that implements it; shown as a hint while it is a placeholder. */
  pending?: boolean;
  /**
   * Name of a counter this entry shows as a badge.
   *
   * The sidebar is a Client Component and cannot query anything, so the number
   * is threaded in from the layout. Only the *name* lives here, which keeps
   * the nav table declarative.
   */
  badge?: 'approvals';
};

const NAV_GROUPS: { items: NavItem[] }[] = [
  {
    items: [
      { href: '/inbox', label: 'Inbox', icon: Inbox },
      { href: '/today', label: 'Hoy', icon: CalendarCheck },
      { href: '/upcoming', label: 'Próximas', icon: CalendarDays },
    ],
  },
  {
    items: [
      { href: '/tasks', label: 'Tareas', icon: ListChecks },
      { href: '/board', label: 'Tablero', icon: SquareKanban },
      { href: '/projects', label: 'Proyectos', icon: FolderKanban },
      { href: '/notes', label: 'Notas', icon: NotebookPen },
    ],
  },
  {
    items: [
      { href: '/approvals', label: 'Aprobaciones', icon: ShieldCheck, badge: 'approvals' },
      { href: '/agents', label: 'Agentes', icon: Bot },
      { href: '/runs', label: 'Runs', icon: PlayCircle },
    ],
  },
  {
    items: [
      { href: '/activity', label: 'Actividad', icon: Activity },
    ],
  },
];

export type NavBadges = { approvals?: number };

/**
 * Floating label shown next to an icon when the sidebar is collapsed.
 *
 * It is positioned `fixed` from the hovered element's box so the sidebar's own
 * `overflow-hidden` (what makes the width transition work) never clips it, and
 * it also appears on keyboard focus.
 */
function SidebarTooltip({ label, children }: { label: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  function show(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setAnchor({ top: rect.top + rect.height / 2, left: rect.right + 10 });
  }

  return (
    <div
      className="relative"
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onFocus={(event) => show(event.currentTarget)}
      onBlur={() => setAnchor(null)}
      onPointerDown={() => setAnchor(null)}
    >
      {children}
      {anchor && (
        <span
          role="tooltip"
          style={{ top: anchor.top, left: anchor.left }}
          className="pointer-events-none fixed z-[70] -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        >
          {label}
        </span>
      )}
    </div>
  );
}

export function SidebarBrand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="grid size-6 shrink-0 place-items-center rounded bg-accent text-[11px] font-bold text-accent-foreground">
        AD
      </span>
      <span className="truncate text-sm font-semibold tracking-tight text-white">AgentDesk</span>
    </div>
  );
}

/** Brand plus the "hide" control: only meaningful on a pointer-sized screen. */
function SidebarHeader({ collapsed, onHide }: { collapsed: boolean; onHide: () => void }) {
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center border-b border-white/5',
        collapsed ? 'justify-center px-0' : 'gap-2 px-3',
      )}
    >
      {collapsed ? (
        <span
          className="grid size-6 place-items-center rounded bg-accent text-[11px] font-bold text-accent-foreground"
          aria-hidden
        >
          AD
        </span>
      ) : (
        <SidebarBrand className="min-w-0 flex-1" />
      )}

      {!collapsed && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onHide}
          aria-label="Ocultar barra lateral"
          title="Ocultar barra lateral"
          className="size-8 shrink-0 text-sidebar-foreground hover:bg-sidebar-active hover:text-white"
        >
          <PanelLeft className="size-4" />
        </Button>
      )}
    </div>
  );
}

export function AppSidebarNav({
  user,
  badges,
  collapsed = false,
  onNavigate,
}: {
  user: { name: string; email: string };
  badges?: NavBadges;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
      router.replace('/login');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  function renderLink(item: NavItem) {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const count = item.badge ? badges?.[item.badge] ?? 0 : 0;

    const link = (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={cn(
          'group flex min-h-11 items-center rounded-md text-sm transition-colors md:min-h-9',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          active
            ? 'bg-sidebar-active text-white'
            : 'text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white',
        )}
      >
        <span className="relative shrink-0">
          <item.icon className="size-4" aria-hidden />
          {collapsed && count > 0 && (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-accent" aria-hidden />
          )}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
        {!collapsed && count > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
            {count}
            <span className="sr-only"> esperando tu decisión</span>
          </span>
        )}
        {!collapsed && item.pending && (
          <span
            className="ml-auto size-1.5 shrink-0 rounded-full bg-current opacity-30"
            title="Aún no implementado"
          />
        )}
      </Link>
    );

    return collapsed ? <SidebarTooltip label={item.label}>{link}</SidebarTooltip> : link;
  }

  const settingsActive = pathname === '/settings' || pathname.startsWith('/settings/');

  const settingsLink = (
    <Link
      href="/settings"
      onClick={onNavigate}
      aria-current={settingsActive ? 'page' : undefined}
      aria-label={collapsed ? 'Ajustes' : undefined}
      className={cn(
        'flex min-h-11 items-center rounded-md text-sm transition-colors md:min-h-9',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        settingsActive
          ? 'bg-sidebar-active text-white'
          : 'text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white',
      )}
    >
      <Settings className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">Ajustes</span>}
    </Link>
  );

  return (
    <>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2" aria-label="Secciones">
        {NAV_GROUPS.map((group, index) => (
          <ul key={index} className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>{renderLink(item)}</li>
            ))}
          </ul>
        ))}
      </nav>

      <div className={cn('border-t border-white/10 p-2', collapsed && 'px-1.5')}>
        {collapsed ? <SidebarTooltip label="Ajustes">{settingsLink}</SidebarTooltip> : settingsLink}

        {collapsed ? (
          <div className="mt-1 flex flex-col items-center gap-0.5">
            <SidebarTooltip label={`${user.name} · ${user.email}`}>
              <span
                className="grid size-9 place-items-center rounded-full bg-white/10 text-xs font-medium text-white"
                aria-hidden
              >
                {user.name.slice(0, 1).toUpperCase()}
              </span>
            </SidebarTooltip>
            <SidebarTooltip label="Cambiar tema">
              <ThemeToggle className="size-9" />
            </SidebarTooltip>
            <SidebarTooltip label="Cerrar sesión">
              <Button
                variant="ghost"
                size="icon"
                onClick={signOut}
                disabled={signingOut}
                aria-label="Cerrar sesión"
                className="size-9 text-sidebar-foreground hover:bg-sidebar-active hover:text-white"
              >
                <LogOut className="size-4" />
              </Button>
            </SidebarTooltip>
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2 rounded-md px-1.5 py-1.5">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-medium text-white"
              aria-hidden
            >
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-medium text-white">{user.name}</p>
              <p className="truncate text-[11px] text-sidebar-foreground">{user.email}</p>
            </div>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              className="size-11 text-sidebar-foreground hover:bg-sidebar-active hover:text-white md:size-9"
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Desktop sidebar.
 *
 * The width is the only thing that changes between states, so a single
 * `transition-[width]` animates all three. Anything else follows from the same
 * state, which is what keeps this centralised instead of per-screen.
 */
export function AppSidebar({
  user,
  badges,
  state,
  onHide,
}: {
  user: { name: string; email: string };
  badges?: NavBadges;
  state: SidebarState;
  onHide: () => void;
}) {
  const collapsed = state !== 'expanded';
  const hidden = state === 'hidden';

  return (
    <aside
      data-state={state}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={cn(
        'relative z-30 hidden shrink-0 flex-col overflow-hidden bg-sidebar transition-[width] duration-200 ease-out md:flex',
        state === 'expanded' && 'w-60',
        state === 'collapsed' && 'w-16',
        state === 'hidden' && 'w-0',
      )}
    >
      <SidebarHeader collapsed={collapsed} onHide={onHide} />
      <AppSidebarNav user={user} badges={badges} collapsed={collapsed} />
    </aside>
  );
}

/**
 * Phone navigation: the same nav as the desktop sidebar, inside a drawer.
 *
 * Radix handles the two ways out that matter here — clicking the overlay and
 * pressing Escape — so there is no bespoke dismissal logic to get wrong.
 */
export function MobileSidebar({
  open,
  onOpenChange,
  user,
  badges,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { name: string; email: string };
  badges?: NavBadges;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-72 max-w-[85vw] border-r-0 bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground [&>button]:hover:text-white"
      >
        <SheetTitle className="sr-only">Navegación</SheetTitle>
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center border-b border-white/5 px-3">
            <SidebarBrand className="min-w-0 flex-1" />
          </div>
          <AppSidebarNav user={user} badges={badges} onNavigate={() => onOpenChange(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
