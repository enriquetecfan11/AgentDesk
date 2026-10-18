'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const GLOBAL_SHORTCUTS = [
  { keys: 'Ctrl/⌘ K', label: 'Abrir la paleta de comandos' },
  { keys: 'C', label: 'Captura rápida en cualquier pantalla' },
  { keys: '?', label: 'Mostrar esta ayuda' },
  { keys: 'Esc', label: 'Cerrar el diálogo o el panel de la tarea' },
  { keys: 'Enter', label: 'Guardar en la captura rápida (Shift+Enter: salto de línea)' },
];

/**
 * Reference card for the keyboard layer. Kept in sync with `AppCommands` by
 * hand: there are few enough shortcuts that a shared table would be more
 * machinery than it is worth.
 */
export function ShortcutHelp({
  open,
  onOpenChange,
  navigation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigation: { label: string; keys: string }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>
            Los atajos de una sola letra se ignoran mientras escribes en un campo de texto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Navegación
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Pulsa <Key>G</Key> y después la letra de la sección.
            </p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {navigation.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{item.label}</span>
                  <Key>{item.keys}</Key>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Generales
            </h3>
            <ul className="space-y-1.5">
              {GLOBAL_SHORTCUTS.map((item) => (
                <li key={item.keys} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <Key>{item.keys}</Key>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Captura rápida
            </h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                <code className="font-mono text-foreground">mañana</code>,{' '}
                <code className="font-mono text-foreground">el viernes</code>,{' '}
                <code className="font-mono text-foreground">15/02</code>,{' '}
                <code className="font-mono text-foreground">en 3 días</code> — fecha
              </li>
              <li>
                <code className="font-mono text-foreground">10:00</code>,{' '}
                <code className="font-mono text-foreground">a las 9</code> — hora
              </li>
              <li>
                <code className="font-mono text-foreground">p1</code>–
                <code className="font-mono text-foreground">p4</code> o{' '}
                <code className="font-mono text-foreground">!urgente</code> — prioridad
              </li>
              <li>
                <code className="font-mono text-foreground">#proyecto</code> — proyecto existente
              </li>
              <li>
                <code className="font-mono text-foreground">@etiqueta</code> — etiqueta (se crea si
                no existe)
              </li>
              <li>
                <code className="font-mono text-foreground">cada lunes</code>,{' '}
                <code className="font-mono text-foreground">todos los días</code> — repetición
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}
