'use client';

import { TaskRow } from '@/components/tasks/task-row';
import { StatusIcon } from '@/components/tasks/task-icons';
import { TASK_STATUSES, TASK_STATUS_META } from '@/lib/constants';
import type { TaskDTO } from '@/lib/types';

function bySortOrder(a: TaskDTO, b: TaskDTO) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Linear-style grouped list: one section per status, only the non-empty ones.
 */
export function TaskListView({
  tasks,
  onOpen,
  onToggleDone,
  onDelete,
  showProject = true,
}: {
  tasks: TaskDTO[];
  onOpen: (task: TaskDTO) => void;
  onToggleDone: (task: TaskDTO) => void;
  onDelete: (task: TaskDTO) => void;
  showProject?: boolean;
}) {
  const groups = TASK_STATUSES.map((status) => ({
    status,
    items: tasks.filter((task) => task.status === status).sort(bySortOrder),
  })).filter((group) => group.items.length > 0);

  if (groups.length === 0) {
    return (
      <div className="grid place-items-center px-6 py-24 text-center">
        <p className="text-sm font-medium">No hay tareas que coincidan</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Ajusta los filtros o crea una tarea nueva con el botón de arriba.
        </p>
      </div>
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <section key={group.status} aria-label={TASK_STATUS_META[group.status].label}>
          <header className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <StatusIcon status={group.status} />
            <h2 className="text-xs font-medium text-muted-foreground">
              {TASK_STATUS_META[group.status].label}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {group.items.length}
            </span>
          </header>

          {group.items.map((task) => (
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
