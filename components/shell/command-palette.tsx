'use client';

import {
  Activity,
  Bot,
  CalendarCheck,
  CalendarDays,
  FolderKanban,
  Inbox,
  Keyboard,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  NotebookPen,
  PlayCircle,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { api } from '@/lib/api-client';
import { hasCaptureDetail, parseCapture } from '@/lib/capture';
import type { ProjectDTO, TaskDTO } from '@/lib/types';

export type PaletteMode = 'command' | 'capture';

export const NAVIGATION: { href: string; label: string; icon: LucideIcon; keys?: string }[] = [
  { href: '/inbox', label: 'Inbox', icon: Inbox, keys: 'G I' },
  { href: '/today', label: 'Hoy', icon: CalendarCheck, keys: 'G H' },
  { href: '/upcoming', label: 'Próximas', icon: CalendarDays, keys: 'G U' },
  { href: '/tasks', label: 'Tareas', icon: ListChecks, keys: 'G T' },
  { href: '/projects', label: 'Proyectos', icon: FolderKanban, keys: 'G P' },
  { href: '/notes', label: 'Notas', icon: NotebookPen, keys: 'G N' },
  { href: '/approvals', label: 'Aprobaciones', icon: ShieldCheck, keys: 'G V' },
  { href: '/activity', label: 'Actividad', icon: Activity, keys: 'G A' },
  { href: '/agents', label: 'Agentes', icon: Bot, keys: 'G B' },
  { href: '/runs', label: 'Runs', icon: PlayCircle, keys: 'G R' },
  { href: '/settings', label: 'Ajustes', icon: Settings, keys: 'G S' },
];

/**
 * Cmd/Ctrl+K.
 *
 * Two modes over one input. In command mode it searches tasks and projects and
 * runs shell actions; in capture mode it is a one-line natural-language task
 * creator, so a task can be filed from anywhere without leaving the page.
 */
export function CommandPalette({
  open,
  mode,
  onOpenChange,
  onShowShortcuts,
  onSignOut,
  onStartCapture,
}: {
  open: boolean;
  mode: PaletteMode;
  onOpenChange: (open: boolean) => void;
  onShowShortcuts: () => void;
  onSignOut: () => void;
  /** Switches the open palette to capture mode. */
  onStartCapture: () => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ tasks: TaskDTO[]; projects: ProjectDTO[] }>({
    tasks: [],
    projects: [],
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults({ tasks: [], projects: [] });
    }
  }, [open]);

  // Server-side search, debounced. Two characters minimum, same as the API.
  useEffect(() => {
    if (mode !== 'command') return;

    const value = query.trim();
    if (value.length < 2) {
      setResults({ tasks: [], projects: [] });
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ tasks: TaskDTO[]; projects: ProjectDTO[] }>(
          `/api/search?q=${encodeURIComponent(value)}`,
        );
        if (!cancelled) setResults(data);
      } catch {
        // A failed search must not break the palette.
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode]);

  const capture = parseCapture(query);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  async function submitCapture() {
    const text = query.trim();
    if (!text || busy) return;

    setBusy(true);
    try {
      const result = await api.post<{ task: TaskDTO; notes: string[] }>('/api/capture', { text });

      for (const note of result.notes) toast.warning(note);
      toast.success(`Capturado: ${result.task.title}`);

      onOpenChange(false);
      router.push('/inbox');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo capturar la tarea');
    } finally {
      setBusy(false);
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={
          mode === 'capture'
            ? 'Describe la tarea y pulsa Intro… «llamar a Marina mañana 10:00 p1»'
            : 'Buscar una tarea, un proyecto o ejecutar una acción…'
        }
      />

      <CommandList>
        {mode === 'capture' ? (
          <>
            <CommandGroup heading="Captura rápida">
              <CommandItem
                // The value carries the query so cmdk never filters this item
                // out while the user is still typing the sentence.
                value={`capturar ${query}`}
                onSelect={() => void submitCapture()}
                disabled={query.trim().length === 0}
              >
                <Plus className="mr-2 size-4" />
                <span className="truncate">
                  {capture.title.trim().length > 0 ? capture.title : 'Escribe algo'}
                </span>
                {hasCaptureDetail(capture) && (
                  <CommandShortcut>{capture.hints.join(' · ')}</CommandShortcut>
                )}
              </CommandItem>
            </CommandGroup>

            <div className="px-3 pb-3 text-xs text-muted-foreground">
              Se entiende fechas («mañana», «el viernes», «15/02»), horas («10:00»),
              <code className="mx-1 font-mono">p1</code>–
              <code className="mx-1 font-mono">p4</code>,{' '}
              <code className="mx-1 font-mono">#proyecto</code>,{' '}
              <code className="mx-1 font-mono">@etiqueta</code> y repeticiones («cada lunes»).
            </div>
          </>
        ) : (
          <>
            <CommandEmpty>Sin resultados.</CommandEmpty>

            {results.tasks.length > 0 && (
              <CommandGroup heading="Tareas">
                {results.tasks.map((task) => (
                  <CommandItem
                    key={task.id}
                    // The server already filtered: the query is part of the
                    // value so cmdk's own filter does not discard the row.
                    value={`${query} ${task.title} ${task.id}`}
                    onSelect={() => go(`/tasks?tarea=${task.id}`)}
                  >
                    <ListChecks className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{task.title}</span>
                    {task.project && (
                      <CommandShortcut>{task.project.name}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results.projects.length > 0 && (
              <CommandGroup heading="Proyectos">
                {results.projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`${query} ${project.name} ${project.id}`}
                    onSelect={() => go(`/projects/${project.id}`)}
                  >
                    <FolderKanban className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{project.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup heading="Ir a">
              {NAVIGATION.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`ir ${item.label}`}
                  onSelect={() => go(item.href)}
                >
                  <item.icon className="mr-2 size-4" />
                  {item.label}
                  {item.keys && <CommandShortcut>{item.keys}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup heading="Acciones">
              <CommandItem value="nueva tarea capturar" onSelect={onStartCapture}>
                <Plus className="mr-2 size-4" />
                Nueva tarea
                <CommandShortcut>C</CommandShortcut>
              </CommandItem>

              <CommandItem
                value="tema claro"
                onSelect={() => {
                  setTheme('light');
                  onOpenChange(false);
                }}
              >
                <Sun className="mr-2 size-4" />
                Tema claro
              </CommandItem>

              <CommandItem
                value="tema oscuro"
                onSelect={() => {
                  setTheme('dark');
                  onOpenChange(false);
                }}
              >
                <Moon className="mr-2 size-4" />
                Tema oscuro
              </CommandItem>

              <CommandItem
                value="tema sistema"
                onSelect={() => {
                  setTheme('system');
                  onOpenChange(false);
                }}
              >
                <Monitor className="mr-2 size-4" />
                Tema del sistema
              </CommandItem>

              <CommandItem
                value="atajos de teclado"
                onSelect={() => {
                  onOpenChange(false);
                  onShowShortcuts();
                }}
              >
                <Keyboard className="mr-2 size-4" />
                Atajos de teclado
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>

              <CommandItem value="cerrar sesión salir" onSelect={onSignOut}>
                <LogOut className="mr-2 size-4" />
                Cerrar sesión
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
