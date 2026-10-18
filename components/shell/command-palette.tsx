'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Command } from 'cmdk';
import { format } from 'date-fns';
import { createTask, listAgents, listProjects, listTasks, updateTask } from '@/lib/api';
import type { AgentWithActor, Project, TaskWithRefs } from '@/lib/types';
import { parseCapture } from '@/lib/capture';
import { cn } from '@/lib/utils';
import { CornerDownLeft, Loader2 } from 'lucide-react';

interface PaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PaletteContext = createContext<PaletteContextValue>({ open: false, setOpen: () => {} });
export const usePalette = () => useContext(PaletteContext);

type Mode = 'root' | 'capture' | 'delegate';

export function CommandPalette({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('root');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [capturePreview, setCapturePreview] = useState<ReturnType<typeof parseCapture> | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [agents, setAgents] = useState<AgentWithActor[]>([]);
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);

  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
    listAgents().then(setAgents).catch(() => {});
    listTasks({ includeDone: false }).then((t) => setTasks(t.slice(0, 40))).catch(() => {});
  }, [pathname]);

  const close = useCallback(() => {
    setOpen(false);
    setMode('root');
    setSearch('');
    setCapturePreview(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setMode('root');
        setSearch('');
      }
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const runCapture = useCallback(async () => {
    if (!search.trim() || busy) return;
    setBusy(true);
    try {
      const parsed = parseCapture(search);
      let projectId: string | null = null;
      if (parsed.projectName) {
        const match = projects.find((p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase());
        projectId = match?.id ?? null;
      }
      await createTask({
        title: parsed.title,
        priority: parsed.priority ?? 'normal',
        due_date: parsed.dueDate,
        project_id: projectId,
      });
      router.refresh();
      close();
    } finally {
      setBusy(false);
    }
  }, [search, busy, projects, router, close]);

  useEffect(() => {
    if (mode === 'capture') {
      const t = setTimeout(() => setCapturePreview(parseCapture(search)), 50);
      return () => clearTimeout(t);
    }
  }, [search, mode]);

  const navItems = useMemo(
    () => [
      { label: 'Ir a Hoy', href: '/', shortcut: 'G H' },
      { label: 'Ir a Inbox', href: '/inbox', shortcut: 'G I' },
      { label: 'Ir a Tareas', href: '/tasks', shortcut: 'G T' },
      { label: 'Ir a Calendario', href: '/calendar', shortcut: 'G C' },
      { label: 'Ir a Proyectos', href: '/projects', shortcut: 'G P' },
      { label: 'Ir a Agentes', href: '/agents', shortcut: 'G A' },
      { label: 'Ir a Actividad', href: '/activity', shortcut: 'G Y' },
    ],
    [],
  );

  const delegateTask = useCallback(
    async (taskId: string, agentId: string) => {
      setBusy(true);
      try {
        const { createDelegation } = await import('@/lib/api');
        await createDelegation({
          task_id: taskId,
          agent_id: agentId,
          brief: 'Delegado desde command palette',
        });
        await updateTask(taskId, { status: 'review' });
        router.refresh();
        close();
      } finally {
        setBusy(false);
      }
    },
    [router, close],
  );

  return (
    <PaletteContext.Provider value={{ open, setOpen }}>
      {children}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/50" onClick={close} />
          <Command
            loop
            className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
            onKeyDown={(e) => {
              if (mode !== 'root' && e.key === 'Backspace' && !search) {
                e.preventDefault();
                setMode('root');
              }
            }}
          >
            <div className="flex items-center gap-2 border-b border-border px-4">
              {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <SearchIcon />}
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder={
                  mode === 'capture' ? 'Idea o tarea (usa #proyecto, !prioridad, mañana/lunes/24/10…)' :
                  mode === 'delegate' ? 'Buscar tarea para delegar…' :
                  'Escribe un comando o busca…'
                }
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
            </div>

            <Command.List className="max-h-80 overflow-y-auto p-1.5 text-sm">
              <Command.Empty className="px-3 py-6 text-center text-muted-foreground">
                Sin resultados
              </Command.Empty>

              {mode === 'root' && (
                <>
                  <Group heading="Acciones">
                    <Item value="capturar" onSelect={() => { setMode('capture'); setSearch(''); }}>
                      Capturar idea o tarea <kbd className="ml-auto text-[10px] text-muted-foreground">C</kbd>
                    </Item>
                    <Item value="delegar" onSelect={() => { setMode('delegate'); setSearch(''); }}>
                      Delegar tarea a un agente <kbd className="ml-auto text-[10px] text-muted-foreground">D</kbd>
                    </Item>
                  </Group>
                  <Group heading="Navegación">
                    {navItems.map((n) => (
                      <Item key={n.href} value={n.label} onSelect={() => { router.push(n.href); close(); }}>
                        {n.label} <kbd className="ml-auto text-[10px] text-muted-foreground">{n.shortcut}</kbd>
                      </Item>
                    ))}
                  </Group>
                  {projects.length > 0 && (
                    <Group heading="Proyectos">
                      {projects.map((p) => (
                        <Item key={p.id} value={`proyecto ${p.name}`} onSelect={() => { router.push(`/projects/${p.id}`); close(); }}>
                          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                          {p.name}
                        </Item>
                      ))}
                    </Group>
                  )}
                  {tasks.length > 0 && (
                    <Group heading="Tareas">
                      {tasks.slice(0, 10).map((t) => (
                        <Item key={t.id} value={`tarea ${t.title}`} onSelect={() => { router.push(`/tasks?open=${t.id}`); close(); }}>
                          {t.title}
                          {t.project?.name && (
                            <span className="ml-2 text-xs text-muted-foreground">{t.project.name}</span>
                          )}
                        </Item>
                      ))}
                    </Group>
                  )}
                </>
              )}

              {mode === 'capture' && (
                <Group heading="Captura">
                  {capturePreview && (
                    <div className="px-3 py-2 text-xs text-muted-foreground space-y-1">
                      {capturePreview.projectName && (
                        <div>Proyecto: <span className="text-foreground">{capturePreview.projectName}</span>
                          {projects.some((p) => p.name.toLowerCase() === capturePreview.projectName!.toLowerCase()) ? '' : ' (se creará una tarea sin proyecto si no coincide)'}</div>
                      )}
                      {capturePreview.dueDate && <div>Fecha: <span className="text-foreground">{format(new Date(capturePreview.dueDate + 'T12:00:00'), 'd MMM yyyy')}</span></div>}
                      {capturePreview.priority && <div>Prioridad: <span className="text-foreground">{capturePreview.priority}</span></div>}
                      <div>Título: <span className="text-foreground">{capturePreview.title || '—'}</span></div>
                    </div>
                  )}
                  <Item value="confirmar captura" onSelect={runCapture}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
                    Añadir a Inbox
                  </Item>
                </Group>
              )}

              {mode === 'delegate' && (
                <>
                  <Group heading="Tarea">
                    {tasks
                      .filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))
                      .slice(0, 8)
                      .map((t) => (
                        <Item key={t.id} value={`seleccionar ${t.title}`} onSelect={() => {
                          const agent = agents[0];
                          if (agent) delegateTask(t.id, agent.id);
                        }}>
                          {t.title}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {agents[0] ? `-> ${agents[0].name}` : 'sin agentes registrados'}
                          </span>
                        </Item>
                      ))}
                  </Group>
                  <Group heading="Agente">
                    {agents.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: a.actor?.color ?? '#6b7280' }} />
                        {a.name} — {a.kind}
                      </div>
                    ))}
                  </Group>
                </>
              )}
            </Command.List>
            <div className="flex items-center gap-3 border-t border-border px-4 py-1.5 text-[10px] text-muted-foreground">
              <span><kbd className="rounded bg-muted px-1">↑↓</kbd> navegar</span>
              <span><kbd className="rounded bg-muted px-1">↵</kbd> ejecutar</span>
              <span><kbd className="rounded bg-muted px-1">⌫</kbd> atrás</span>
            </div>
          </Command>
        </div>
      )}
    </PaletteContext.Provider>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <Command.Group heading={heading} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
      {children}
    </Command.Group>
  );
}

function Item({ value, onSelect, children }: { value: string; onSelect: () => void; children: React.ReactNode }) {
  return (
    <Command.Item
      value={value}
      onSelect={() => onSelect()}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none',
        'data-[selected=true]:bg-accent-muted data-[selected=true]:text-accent',
      )}
    >
      {children}
    </Command.Item>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4-4" strokeLinecap="round" />
    </svg>
  );
}
