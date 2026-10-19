'use client';

import { Menu, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';

import type { SidebarState } from '@/components/shell/app-sidebar';
import { Button } from '@/components/ui/button';
import { openCapture, openCommandPalette } from '@/lib/events';

const TITLES: { match: string; title: string }[] = [
  { match: '/inbox', title: 'Inbox' },
  { match: '/today', title: 'Hoy' },
  { match: '/upcoming', title: 'Próximas' },
  { match: '/tasks', title: 'Tareas' },
  { match: '/board', title: 'Tablero' },
  { match: '/projects', title: 'Proyectos' },
  { match: '/notes', title: 'Notas' },
  { match: '/approvals', title: 'Aprobaciones' },
  { match: '/activity', title: 'Actividad' },
  { match: '/agents', title: 'Agentes' },
  { match: '/runs', title: 'Runs' },
  { match: '/settings', title: 'Ajustes' },
];

/**
 * The app header.
 *
 * It holds the single control that keeps the sidebar reachable in every state:
 * on a phone it opens the drawer, on a pointer-sized screen it collapses,
 * expands or brings the sidebar back when it is hidden. The search field keeps
 * its hint on wider screens and shrinks to its icon when there is no room for
 * it, so the actions never push the layout sideways.
 */
export function Topbar({
  sidebarState,
  onToggleSidebar,
  onOpenMobile,
}: {
  sidebarState: SidebarState;
  onToggleSidebar: () => void;
  onOpenMobile: () => void;
}) {
  const pathname = usePathname();
  const title = TITLES.find((entry) => pathname.startsWith(entry.match))?.title ?? 'AgentDesk';
  const collapsed = sidebarState !== 'expanded';

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-border px-3 md:px-4">
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenMobile}
        className="size-9 shrink-0 md:hidden"
        aria-label="Abrir menú"
        title="Abrir menú"
      >
        <Menu className="size-5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleSidebar}
        className="hidden size-9 shrink-0 md:inline-flex"
        aria-label={collapsed ? 'Mostrar barra lateral' : 'Contraer barra lateral'}
        title={collapsed ? 'Mostrar barra lateral' : 'Contraer barra lateral'}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>

      <h1 className="truncate text-sm font-medium">{title}</h1>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={openCommandPalette}
          className="h-9 w-9 gap-2 px-0 text-muted-foreground sm:w-56 sm:justify-start sm:px-3"
          aria-label="Buscar o ejecutar un comando"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="hidden text-xs sm:inline">Buscar o ejecutar…</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1 font-mono text-[10px] lg:inline">
            ⌘K
          </kbd>
        </Button>

        <Button
          size="sm"
          onClick={openCapture}
          className="h-9 w-9 gap-1.5 px-0 lg:w-auto lg:px-3"
          aria-label="Captura rápida"
          title="Captura rápida (C)"
        >
          <Plus className="size-4" />
          <span className="hidden text-xs lg:inline">Capturar</span>
        </Button>
      </div>
    </header>
  );
}
