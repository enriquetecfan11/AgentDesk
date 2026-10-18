'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';

import { AppSidebarNav, SidebarBrand } from '@/components/shell/app-sidebar';

/**
 * Mobile navigation. It runs on the same data as the desktop sidebar; only the
 * container differs, so the two can never drift apart.
 */
export function MobileNav({ user }: { user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);

  // Close when the viewport grows past the md breakpoint.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = () => query.matches && setOpen(false);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 md:hidden" aria-label="Abrir menú">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 border-r-0 bg-sidebar p-0 text-sidebar-foreground">
        <SheetTitle className="sr-only">Navegación</SheetTitle>
        <div className="flex h-full flex-col">
          <SidebarBrand />
          <AppSidebarNav user={user} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
