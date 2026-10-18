'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, isToday, isPast, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Circle, CircleDot, GripVertical, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateTask } from '@/lib/api';
import type { TaskStatus, TaskWithRefs } from '@/lib/types';
import { TASK_PRIORITIES } from '@/lib/types';
import { OriginBadge } from '@/components/ui/badge-dot';

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  backlog: 'in_progress',
  in_progress: 'review',
  review: 'done',
  done: 'backlog',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'En curso',
  review: 'En revisión',
  done: 'Hecho',
};

export function TaskRow({
  task, isOpen, onOpen, showProject = true, draggable = false,
}: {
  task: TaskWithRefs; isOpen?: boolean; onOpen?: () => void;
  showProject?: boolean; draggable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const priority = TASK_PRIORITIES.find((p) => p.value === task.priority);
  const overdue =
    task.due_date && task.status !== 'done' && isPast(parseISO(task.due_date + 'T23:59:59'));
  const dueToday = task.due_date && isToday(parseISO(task.due_date + 'T12:00:00'));

  const cycle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await updateTask(task.id, { status: NEXT_STATUS[task.status] });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' && onOpen) onOpen(); }}
      role="button"
      tabIndex={0}
      className={cn(
        'group flex cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-3 py-2 hover:border-border hover:bg-muted/60',
        isOpen && 'border-border bg-muted/80',
        task.status === 'done' && 'opacity-55',
      )}
    >
      {draggable && (
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/50" />
      )}
      <button
        onClick={cycle}
        className="shrink-0"
        aria-label={`Estado: ${STATUS_LABEL[task.status]}. Click para avanzar`}
        title={`Click para avanzar a ${STATUS_LABEL[NEXT_STATUS[task.status]]}`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : task.status === 'done' ? (
          <Circle className="h-4 w-4 fill-success stroke-success" />
        ) : task.status === 'backlog' ? (
          <Circle className="h-4 w-4 text-muted-foreground" />
        ) : (
          <CircleDot className={cn('h-4 w-4', task.status === 'in_progress' ? 'text-warning' : 'text-accent')} />
        )}
      </button>
      <span className={cn('min-w-0 flex-1 truncate text-[13px]', task.status === 'done' && 'line-through')}>
        {task.title}
      </span>
      {task.origin !== 'human' && <OriginBadge origin={task.origin} />}
      {showProject && task.project && (
        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: task.project.color }} />
          {task.project.name}
        </span>
      )}
      {task.due_date && (
        <span
          className={cn(
            'shrink-0 text-[11px]',
            overdue ? 'font-medium text-destructive' : dueToday ? 'font-medium text-warning' : 'text-muted-foreground',
          )}
        >
          {format(parseISO(task.due_date + 'T12:00:00'), overdue || dueToday ? 'd MMM' : 'd MMM', { locale: es })}
        </span>
      )}
      {priority && priority.value !== 'normal' && (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: priority.color }} title={priority.label} />
      )}
    </div>
  );
}

export function TaskList({
  tasks, showProject = true, draggable = false,
}: {
  tasks: TaskWithRefs[]; showProject?: boolean; draggable?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const router = useRouter();

  if (tasks.length === 0) {
    return <div className="px-3 py-8 text-center text-sm text-muted-foreground">Nada por aquí</div>;
  }

  return (
    <div className="divide-y divide-transparent">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          showProject={showProject}
          draggable={draggable}
          isOpen={openId === t.id}
          onOpen={() => {
            setOpenId(t.id);
            router.push(`/tasks?open=${t.id}`);
          }}
        />
      ))}
    </div>
  );
}
