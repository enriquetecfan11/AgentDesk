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
  PlayCircle,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { ThemeToggle } from '@/components/shell/theme-toggle';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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

export function SidebarBrand() {
  return (
    <div className="flex h-14 items-center gap-2 px-4">
      <span className="grid size-6 place-items-center rounded bg-accent text-[11px] font-bold text-accent-foreground">
        AD
      </span>
      <span className="text-sm font-semibold tracking-tight text-white">AgentDesk</span>
    </div>
  );
}

export type NavBadges = { approvals?: number };

export function AppSidebarNav({
  user,
  badges,
  onNavigate,
}: {
  user: { name: string; email: string };
  badges?: NavBadges;
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

  return (
    <>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2" aria-label="Secciones">
        {NAV_GROUPS.map((group, index) => (
          <ul key={index} className="space-y-0.5">
            {group.items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors md:min-h-9',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      active
                        ? 'bg-sidebar-active text-white'
                        : 'text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{item.label}</span>
                    {item.badge && (badges?.[item.badge] ?? 0) > 0 && (
                      <span className="ml-auto shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                        {badges?.[item.badge]}
                        <span className="sr-only"> esperando tu decisión</span>
                      </span>
                    )}
                    {item.pending && (
                      <span
                        className="ml-auto size-1.5 shrink-0 rounded-full bg-current opacity-30"
                        title="Aún no implementado"
                      />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>

      <div className="border-t border-white/10 p-2">
        <Link
          href="/settings"
          onClick={onNavigate}
          className={cn(
            'flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors md:min-h-9',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            pathname === '/settings'
              ? 'bg-sidebar-active text-white'
              : 'text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white',
          )}
        >
          <Settings className="size-4" aria-hidden />
          Ajustes
        </Link>

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
      </div>
    </>
  );
}

export function AppSidebar({
  user,
  badges,
}: {
  user: { name: string; email: string };
  badges?: NavBadges;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-sidebar md:flex">
      <SidebarBrand />
      <AppSidebarNav user={user} badges={badges} />
    </aside>
  );
}
