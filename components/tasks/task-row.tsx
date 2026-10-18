'use client';

import { CalendarDays, ListTree, Trash2 } from 'lucide-react';

import { PriorityIcon, StatusIcon } from '@/components/tasks/task-icons';
import { Button } from '@/components/ui/button';
import { TASK_STATUS_META } from '@/lib/constants';
import { formatDueLabel, isOverdue } from '@/lib/dates';
import type { TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export function TaskRow({
  task,
  onOpen,
  onToggleDone,
  onDelete,
  showProject = true,
}: {
  task: TaskDTO;
  onOpen: (task: TaskDTO) => void;
  onToggleDone: (task: TaskDTO) => void;
  onDelete?: (task: TaskDTO) => void;
  showProject?: boolean;
}) {
  const overdue = isOverdue(task.dueDate, task.status);
  const done = task.status === 'done';

  return (
    <div className="group flex items-stretch border-b border-border/70 last:border-b-0 hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onToggleDone(task)}
        className={cn(
          'grid min-h-11 w-10 shrink-0 place-items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          TASK_STATUS_META[task.status].text,
        )}
        aria-label={done ? `Marcar "${task.title}" como pendiente` : `Completar "${task.title}"`}
        title={done ? 'Marcar como pendiente' : 'Completar'}
      >
        <StatusIcon status={task.status} />
      </button>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PriorityIcon priority={task.priority} />

        <span
          className={cn(
            'truncate text-sm',
            done && 'text-muted-foreground line-through',
            task.status === 'cancelled' && 'text-muted-foreground line-through',
          )}
        >
          {task.title}
        </span>

        {task.subtaskTotal > 0 && (
          <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            <ListTree className="size-3.5" />
            {task.subtaskDone}/{task.subtaskTotal}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2 pl-2">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="hidden items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline-flex"
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: label.color ?? 'hsl(var(--muted-foreground))' }}
              />
              {label.name}
            </span>
          ))}

          {showProject && task.project && (
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
              <span
                className="size-2 rounded-[3px]"
                style={{ background: task.project.color ?? 'hsl(var(--muted-foreground))' }}
              />
              {task.project.name}
            </span>
          )}

          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              <CalendarDays className="size-3.5" />
              {formatDueLabel(task.dueDate, task.dueTime)}
            </span>
          )}
        </span>
      </button>

      {onDelete && (
        <div className="flex w-9 shrink-0 items-center justify-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(task)}
            aria-label={`Eliminar "${task.title}"`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
