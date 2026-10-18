'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePalette } from '@/components/shell/command-palette';

export function Topbar({
  title, subtitle, actions,
}: {
  title: string; subtitle?: string; actions?: React.ReactNode;
}) {
  const router = useRouter();
  const { setOpen } = usePalette();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.back()} aria-label="Atrás">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-2 text-xs text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          Buscar o comando
          <kbd className="rounded bg-muted px-1 text-[10px]">⌘K</kbd>
        </Button>
        {actions}
      </div>
    </header>
  );
}
