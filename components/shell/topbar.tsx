'use client';

import { Plus, Search } from 'lucide-react';
import { usePathname } from 'next/navigation';

import { MobileNav } from '@/components/shell/mobile-nav';
import { Button } from '@/components/ui/button';
import { openCapture, openCommandPalette } from '@/lib/events';

const TITLES: { match: string; title: string }[] = [
  { match: '/inbox', title: 'Inbox' },
  { match: '/today', title: 'Hoy' },
  { match: '/upcoming', title: 'Próximas' },
  { match: '/tasks', title: 'Tareas' },
  { match: '/projects', title: 'Proyectos' },
  { match: '/notes', title: 'Notas' },
  { match: '/activity', title: 'Actividad' },
  { match: '/agents', title: 'Agentes' },
  { match: '/runs', title: 'Runs' },
  { match: '/settings', title: 'Ajustes' },
];

export function Topbar({ user }: { user: { name: string; email: string } }) {
  const pathname = usePathname();
  const title = TITLES.find((entry) => pathname.startsWith(entry.match))?.title ?? 'AgentDesk';

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
      <MobileNav user={user} />
      <h1 className="text-sm font-medium">{title}</h1>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={openCommandPalette}
          className="h-8 w-8 gap-2 px-0 text-muted-foreground sm:w-56 sm:justify-start sm:px-3"
          aria-label="Buscar o ejecutar un comando"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="hidden text-xs sm:inline">Buscar o ejecutar…</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-border bg-muted px-1 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </Button>

        <Button
          size="sm"
          onClick={openCapture}
          className="h-8 w-8 gap-1.5 px-0 sm:w-auto sm:px-3"
          aria-label="Captura rápida"
          title="Captura rápida (C)"
        >
          <Plus className="size-4" />
          <span className="hidden text-xs sm:inline">Capturar</span>
        </Button>
      </div>
    </header>
  );
}
