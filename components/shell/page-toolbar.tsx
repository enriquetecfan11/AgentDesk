import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Shared filter bar for the list-style screens.
 *
 * It exists so the Tareas and Tablero screens wrap, size and separate their
 * controls the same way: a toolbar that wraps instead of scrolling sideways,
 * a search field that owns the first row on a phone and grows on wider
 * screens, and action buttons that can be pushed to the right without
 * overflowing.
 */
export function PageToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Groups the filters so they wrap together and stay out of the search's way. */
export function ToolbarFilters({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>{children}</div>
  );
}

/** Search input with the magnifier baked in and a phone-first width. */
export function ToolbarSearch({
  className,
  ...props
}: ComponentProps<typeof Input>) {
  return (
    <div className={cn('relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input className="h-9 pl-8 text-sm sm:h-8" {...props} />
    </div>
  );
}
