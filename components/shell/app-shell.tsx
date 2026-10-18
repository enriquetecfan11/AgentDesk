'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity, Bot, CalendarDays, Inbox,
  LayoutDashboard, ListTodo, PanelLeftClose, PanelLeftOpen, Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CommandPalette, usePalette } from './command-palette';
import { listAgents, listProjects, listTasks } from '@/lib/api';
import type { AgentWithActor, Project } from '@/lib/types';
import { BadgeDot } from '@/components/ui/badge-dot';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [activeAgents, setActiveAgents] = useState<AgentWithActor[]>([]);

  const pathname = usePathname();

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
    listTasks({ inboxOnly: true, includeDone: false })
      .then((t) => setInboxCount(t.length))
      .catch(() => {});
    listAgents().then((a) => setActiveAgents(a.filter((x) => x.status === 'active'))).catch(() => {});
  }, [pathname]);

  const nav = [
    { href: '/', label: 'Hoy', icon: LayoutDashboard },
    { href: '/inbox', label: 'Inbox', icon: Inbox, badge: inboxCount > 0 ? inboxCount : undefined },
    { href: '/tasks', label: 'Tareas', icon: ListTodo },
    { href: '/calendar', label: 'Calendario', icon: CalendarDays },
  ];

  const secondaryNav = [
    { href: '/agents', label: 'Agentes', icon: Bot, badge: activeAgents.length || undefined },
    { href: '/activity', label: 'Actividad', icon: Activity },
  ];

  return (
    <CommandPalette>
      <div className="flex h-screen overflow-hidden">
        <aside
          className={cn(
            'flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-150',
            collapsed ? 'w-14' : 'w-60',
          )}
        >
          <div className="flex items-center gap-2 px-3 py-4">
            {!collapsed && (
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[13px] font-bold text-accent-foreground">
                O
              </div>
            )}
            {!collapsed && <span className="text-sm font-semibold text-foreground">Operative</span>}
            <button
              className={cn('ml-auto rounded p-1 hover:bg-sidebar-active', collapsed && 'mx-auto')}
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>

          {!collapsed && (
            <div className="px-3 pb-3">
              <Link
                href="/inbox?capture=1"
                className="flex items-center gap-2 rounded-md border border-[hsl(var(--sidebar-active))] bg-sidebar-active px-2.5 py-1.5 text-xs text-foreground hover:border-[hsl(var(--input))]"
              >
                <Plus className="h-3.5 w-3.5" /> Capturar
                <kbd className="ml-auto text-[10px] text-sidebar-foreground">C</kbd>
              </Link>
            </div>
          )}

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-2">
            {nav.map((item) => (
              <SidebarLink key={item.href} {...item} collapsed={collapsed} active={pathname === item.href} />
            ))}

            {!collapsed && (
              <div className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/70">
                Proyectos
              </div>
            )}
            {projects.slice(0, 8).map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] hover:bg-sidebar-active',
                  pathname === `/projects/${p.id}` && 'bg-sidebar-active text-foreground',
                  collapsed && 'justify-center px-0',
                )}
                title={p.name}
              >
                <BadgeDot color={p.color} />
                {!collapsed && <span className="truncate">{p.name}</span>}
              </Link>
            ))}

            {!collapsed && (
              <div className="px-3 pb-1 pt-4 text-[10px] font-medium uppercase tracking-wide text-sidebar-foreground/70">
                Sistema
              </div>
            )}
            {secondaryNav.map((item) => (
              <SidebarLink key={item.href} {...item} collapsed={collapsed} active={pathname === item.href} />
            ))}
          </nav>

          {!collapsed && (
            <div className="border-t border-[hsl(var(--sidebar-active))] p-3 text-[11px] text-sidebar-foreground">
              <div className="flex items-center gap-2">
                <BadgeDot color="#22c55e" />
                <span>{activeAgents.length} agente(s) activo(s)</span>
              </div>
              <div className="mt-1 text-[10px] text-sidebar-foreground/70">
                MCP gateway + webhook n8n listos
              </div>
            </div>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
    </CommandPalette>
  );
}

function SidebarLink({
  href, label, icon: Icon, badge, collapsed, active,
}: {
  href: string; label: string; icon: React.ComponentType<{ className?: string }>;
  badge?: number; collapsed: boolean; active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] hover:bg-sidebar-active',
        active && 'bg-sidebar-active text-foreground font-medium',
        collapsed && 'justify-center px-0',
      )}
      title={label}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {badge !== undefined && (
            <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-medium text-accent-foreground">
              {badge}
            </span>
          )}
        </>
      )}
    </Link>
  );
}
