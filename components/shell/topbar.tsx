'use client';

import { usePathname } from 'next/navigation';

import { MobileNav } from '@/components/shell/mobile-nav';

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
    </header>
  );
}
