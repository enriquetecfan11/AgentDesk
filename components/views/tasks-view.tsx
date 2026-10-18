'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { LayoutList, Trello } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { CaptureBox } from '@/components/tasks/capture-box';
import { TaskList } from '@/components/tasks/task-row';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { listTasks } from '@/lib/api';
import type { TaskWithRefs, TaskStatus, TaskPriority } from '@/lib/types';
import { TASK_STATUSES, TASK_PRIORITIES } from '@/lib/types';
import { TaskDetailPanel } from '@/components/panel/task-detail-panel';
import { OriginBadge } from '@/components/ui/badge-dot';

type OwnerFilter = 'all' | 'mine' | 'agents';
type ViewMode = 'list' | 'board';

export function TasksView() {
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState<OwnerFilter>('all');
  const [priority, setPriority] = useState<TaskPriority | 'all'>('all');
  const [mode, setMode] = useState<ViewMode>('list');
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await listTasks({ includeDone: true });
      setTasks(t);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const open = searchParams.get('open');
    if (open) setOpenTaskId(open);
  }, [searchParams]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (priority !== 'all' && t.priority !== priority) return false;
      if (owner === 'mine') return !t.assignee || t.assignee.kind === 'human';
      if (owner === 'agents') return t.assignee?.kind === 'agent' || t.origin === 'agent';
      return true;
    });
  }, [tasks, owner, priority]);

  const active = filtered.filter((t) => t.status !== 'done');
  const done = filtered.filter((t) => t.status === 'done');

  const closePanel = () => {
    setOpenTaskId(null);
    router.replace('/tasks');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar
        title="Tareas"
        subtitle={`${active.length} activas · ${done.length} hechas`}
        actions={
          <Tabs value={mode} onValueChange={(v) => setMode(v as ViewMode)}>
            <TabsList className="h-7">
              <TabsTrigger value="list" className="h-6 gap-1 px-2 text-xs"><LayoutList className="h-3 w-3" /> Lista</TabsTrigger>
              <TabsTrigger value="board" className="h-6 gap-1 px-2 text-xs"><Trello className="h-3 w-3" /> Tablero</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Tabs value={owner} onValueChange={(v) => setOwner(v as OwnerFilter)}>
          <TabsList className="h-7">
            <TabsTrigger value="all" className="h-6 px-2.5 text-xs">Todos</TabsTrigger>
            <TabsTrigger value="mine" className="h-6 gap-1 px-2.5 text-xs"><span className="inline-block h-1.5 w-1.5 rounded-full bg-success" /> Míos</TabsTrigger>
            <TabsTrigger value="agents" className="h-6 gap-1 px-2.5 text-xs"><span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" /> Agentes</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={priority} onValueChange={(v) => setPriority(v as TaskPriority | 'all')}>
          <TabsList className="h-7">
            <TabsTrigger value="all" className="h-6 px-2.5 text-xs">Prioridad: todas</TabsTrigger>
            {TASK_PRIORITIES.map((p) => (
              <TabsTrigger key={p.value} value={p.value} className="h-6 gap-1 px-2.5 text-xs">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <CaptureBox />

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : mode === 'list' ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-card py-1">
                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Activas</div>
                <TaskList tasks={active} />
              </div>
              {done.length > 0 && (
                <div className="rounded-lg border border-border bg-card py-1 opacity-80">
                  <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hechas</div>
                  <TaskList tasks={done} />
                </div>
              )}
            </div>
          ) : (
            <BoardView tasks={filtered} onOpen={setOpenTaskId} />
          )}
        </div>
      </div>

      {openTaskId && (
        <TaskDetailPanel taskId={openTaskId} onClose={closePanel} onChanged={load} />
      )}
    </div>
  );
}

function BoardView({ tasks, onOpen }: { tasks: TaskWithRefs[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s.value);
        return (
          <div key={s.value} className="rounded-lg border border-border bg-muted/40">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</span>
              <span className="text-[11px] text-muted-foreground">{col.length}</span>
            </div>
            <div className="space-y-1 p-2">
              {col.length === 0 ? (
                <div className="py-6 text-center text-[11px] text-muted-foreground">Vacío</div>
              ) : (
                col.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onOpen(t.id)}
                    className="w-full rounded-md border border-border bg-card p-2.5 text-left hover:border-[hsl(var(--ring))]"
                  >
                    <div className={cn('text-[13px] leading-snug', t.status === 'done' && 'text-muted-foreground line-through')}>
                      {t.title}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <OriginBadge origin={t.origin} />
                      {t.project && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: t.project.color }} />
                          {t.project.name}
                        </span>
                      )}
                      {t.due_date && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {format(parseISO(t.due_date + 'T12:00:00'), 'd MMM', { locale: es })}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
