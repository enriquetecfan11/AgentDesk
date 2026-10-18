'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { addMonths, subMonths, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { listTasks, updateTask } from '@/lib/api';
import type { TaskWithRefs } from '@/lib/types';
import { TASK_PRIORITIES } from '@/lib/types';
import { CaptureBox } from '@/components/tasks/capture-box';
import { TaskDetailPanel } from '@/components/panel/task-detail-panel';
import { monthGrid, weekDays, fmtDayName, fmtMonth, isSameDay, isSameMonth, parseISO } from '@/lib/capture';
import { OriginBadge } from '@/components/ui/badge-dot';

type Mode = 'month' | 'week';

export function CalendarView() {
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(new Date());
  const [mode, setMode] = useState<Mode>('month');
  const [selected, setSelected] = useState<Date>(new Date());
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTasks(await listTasks({ includeDone: true }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const open = searchParams.get('open');
    if (open) setOpenTaskId(open);
  }, [searchParams]);

  const byDate = useMemo(() => {
    const map = new Map<string, TaskWithRefs[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const arr = map.get(t.due_date) ?? [];
      arr.push(t);
      map.set(t.due_date, arr);
    }
    return map;
  }, [tasks]);

  const days = mode === 'month' ? monthGrid(cursor) : weekDays(cursor);
  const selectedTasks = byDate.get(format(selected, 'yyyy-MM-dd')) ?? [];

  const closePanel = () => {
    setOpenTaskId(null);
    router.replace('/calendar');
  };

  const moveTask = async (taskId: string, date: Date) => {
    await updateTask(taskId, { due_date: format(date, 'yyyy-MM-dd') });
    load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar
        title="Calendario"
        subtitle="Fechas de vencimiento de tareas"
        actions={
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="h-7">
              <TabsTrigger value="month" className="h-6 px-2.5 text-xs">Mes</TabsTrigger>
              <TabsTrigger value="week" className="h-6 px-2.5 text-xs">Semana</TabsTrigger>
            </TabsList>
          </Tabs>
        }
      />

      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCursor(mode === 'month' ? subMonths(cursor, 1) : new Date(cursor.getTime() - 7 * 86400000))} aria-label="Anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCursor(mode === 'month' ? addMonths(cursor, 1) : new Date(cursor.getTime() + 7 * 86400000))} aria-label="Siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setCursor(new Date()); setSelected(new Date()); }}>
          Hoy
        </Button>
        <span className="ml-2 text-sm font-medium capitalize">{fmtMonth(cursor)}</span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col p-4">
          {loading ? (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="grid grid-cols-7 gap-1 pb-1">
                {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
                  <div key={d} className="py-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {d}
                  </div>
                ))}
              </div>
              <div className={cn('grid grid-cols-7 gap-1', mode === 'week' ? 'flex-1' : '')}>
                {days.map((d) => {
                  const key = format(d, 'yyyy-MM-dd');
                  const dayTasks = byDate.get(key) ?? [];
                  const dim = mode === 'month' && !isSameMonth(d, cursor);
                  const isSel = isSameDay(d, selected);
                  const isTd = isSameDay(d, new Date());
                  return (
                    <button
                      key={key}
                      onClick={() => setSelected(d)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const taskId = e.dataTransfer.getData('text/task-id');
                        if (taskId) moveTask(taskId, d);
                      }}
                      className={cn(
                        'flex flex-col items-stretch rounded-md border p-1 text-left transition-colors',
                        mode === 'week' ? 'min-h-[200px]' : 'min-h-[84px]',
                        isSel ? 'border-[hsl(var(--ring))] bg-accent-muted/50' : 'border-border hover:border-[hsl(var(--input))]',
                        dim && 'opacity-40',
                      )}
                    >
                      <span className={cn(
                        'mb-0.5 self-end rounded px-1 text-[11px]',
                        isTd ? 'bg-accent font-bold text-accent-foreground' : 'text-muted-foreground',
                      )}>
                        {format(d, 'd')}
                      </span>
                      {dayTasks.slice(0, mode === 'week' ? 8 : 3).map((t) => {
                        const pr = TASK_PRIORITIES.find((p) => p.value === t.priority);
                        return (
                          <span
                            key={t.id}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
                            onClick={(e) => { e.stopPropagation(); setOpenTaskId(t.id); }}
                            className="mb-0.5 flex cursor-grab items-center gap-1 truncate rounded bg-muted px-1 py-0.5 text-[10px] hover:bg-muted/80"
                            title={t.title}
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: pr?.color === '#6b7280' || pr?.color === '#94a3b8' ? (t.status === 'done' ? '#22c55e' : pr.color) : pr?.color ?? '#6b7280' }}
                            />
                            <span className={cn('truncate', t.status === 'done' && 'line-through opacity-60')}>{t.title}</span>
                          </span>
                        );
                      })}
                      {mode === 'month' && dayTasks.length > 3 && (
                        <span className="text-[9px] text-muted-foreground">+{dayTasks.length - 3} más</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="w-80 shrink-0 space-y-4 overflow-y-auto border-l border-border p-4">
          <div>
            <h3 className="mb-2 text-[13px] font-semibold">{fmtDayName(selected)}</h3>
            <CaptureBox
              placeholder="Añadir tarea para este día…"
              key={format(selected, 'yyyy-MM-dd')}
            />
          </div>
          <div className="space-y-1">
            {selectedTasks.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-muted-foreground">Sin tareas este día</p>
            ) : (
              selectedTasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setOpenTaskId(t.id)}
                  className="w-full rounded-md border border-border bg-card p-2.5 text-left hover:border-[hsl(var(--ring))]"
                >
                  <div className="text-[13px]">{t.title}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <OriginBadge origin={t.origin} />
                    {t.project && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: t.project.color }} />
                        {t.project.name}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      {openTaskId && (
        <TaskDetailPanel taskId={openTaskId} onClose={closePanel} onChanged={load} />
      )}
    </div>
  );
}
