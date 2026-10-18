'use client';

import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

import { StatusIcon } from '@/components/tasks/task-icons';
import { TaskRow } from '@/components/tasks/task-row';
import { TASK_STATUSES, TASK_STATUS_META } from '@/lib/constants';
import { formatDueLabel, todayIso } from '@/lib/dates';
import type { TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export type TaskGrouping = 'status' | 'today' | 'date' | 'day';

export type TaskSection = {
  key: string;
  title: string;
  icon?: ReactNode;
  tone?: 'danger';
  items: TaskDTO[];
};

function bySortOrder(a: TaskDTO, b: TaskDTO) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/** Dates first, then the time inside the day, then the manual order. */
function byDueThenSort(a: TaskDTO, b: TaskDTO) {
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  if (a.dueTime !== b.dueTime) {
    if (!a.dueTime) return 1;
    if (!b.dueTime) return -1;
    return a.dueTime.localeCompare(b.dueTime);
  }
  return bySortOrder(a, b);
}

/**
 * Turns a flat task list into the sections each screen wants to show.
 *
 * Pure and client-side: the same list can be regrouped without asking the
 * server for anything.
 */
export function groupTasks(
  tasks: TaskDTO[],
  grouping: TaskGrouping,
  day?: string,
): TaskSection[] {
  if (grouping === 'status') {
    return TASK_STATUSES.map((status) => ({
      key: status,
      title: TASK_STATUS_META[status].label,
      icon: <StatusIcon status={status} />,
      items: tasks.filter((task) => task.status === status).sort(bySortOrder),
    }));
  }

  if (grouping === 'today') {
    const today = todayIso();

    return [
      {
        key: 'overdue',
        title: 'Vencidas',
        icon: <AlertTriangle className="size-3.5" />,
        tone: 'danger' as const,
        items: tasks
          .filter((task) => task.dueDate !== null && task.dueDate < today)
          .sort(byDueThenSort),
      },
      {
        key: 'today',
        title: 'Hoy',
        items: tasks.filter((task) => task.dueDate === today).sort(byDueThenSort),
      },
      {
        key: 'unscheduled',
        title: 'Sin fecha',
        items: tasks.filter((task) => !task.dueDate).sort(bySortOrder),
      },
    ];
  }

  if (grouping === 'day') {
    return [
      {
        key: day ?? 'day',
        title: day ? formatDueLabel(day) : 'Tareas',
        items: tasks.filter((task) => task.dueDate === day).sort(byDueThenSort),
      },
    ];
  }

  const byDate = new Map<string, TaskDTO[]>();
  for (const task of tasks) {
    if (!task.dueDate) continue;
    const bucket = byDate.get(task.dueDate) ?? [];
    bucket.push(task);
    byDate.set(task.dueDate, bucket);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ key: date, title: formatDueLabel(date), items: items.sort(byDueThenSort) }));
}

export function TaskSections({
  sections,
  onOpen,
  onToggleDone,
  onDelete,
  showProject = true,
  emptyTitle = 'No hay nada por aquí',
  emptyDescription,
}: {
  sections: TaskSection[];
  onOpen: (task: TaskDTO) => void;
  onToggleDone: (task: TaskDTO) => void;
  onDelete?: (task: TaskDTO) => void;
  showProject?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const visible = sections.filter((section) => section.items.length > 0);

  if (visible.length === 0) {
    return (
      <div className="grid place-items-center px-6 py-24 text-center">
        <p className="text-sm font-medium">{emptyTitle}</p>
        {emptyDescription && (
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{emptyDescription}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      {visible.map((section) => (
        <section key={section.key} aria-label={section.title}>
          <header className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {section.icon}
            <h2
              className={cn(
                'text-xs font-medium',
                section.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {section.title}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {section.items.length}
            </span>
          </header>

          {section.items.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={onOpen}
              onToggleDone={onToggleDone}
              onDelete={onDelete}
              showProject={showProject}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
