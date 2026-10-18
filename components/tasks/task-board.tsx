'use client';

import { CalendarDays, ListTree, MoveRight } from 'lucide-react';
import { useState } from 'react';

import { PriorityIcon } from '@/components/tasks/task-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BOARD_STATUSES, TASK_STATUSES, TASK_STATUS_META } from '@/lib/constants';
import type { TaskStatusValue } from '@/lib/constants';
import { formatDueLabel, isOverdue } from '@/lib/dates';
import type { TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

function bySortOrder(a: TaskDTO, b: TaskDTO) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

type DropTarget = { status: TaskStatusValue; index: number };

export function TaskBoard({
  tasks,
  onOpen,
  onMove,
  showProject = true,
}: {
  tasks: TaskDTO[];
  onOpen: (task: TaskDTO) => void;
  onMove: (id: string, status: TaskStatusValue, index: number) => void;
  showProject?: boolean;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  function commitDrop() {
    if (draggingId && dropTarget) onMove(draggingId, dropTarget.status, dropTarget.index);
    setDraggingId(null);
    setDropTarget(null);
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {BOARD_STATUSES.map((status) => {
        const columnTasks = tasks.filter((task) => task.status === status).sort(bySortOrder);
        const visible = columnTasks.filter((task) => task.id !== draggingId);
        const meta = TASK_STATUS_META[status];

        return (
          <section
            key={status}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/20',
              dropTarget?.status === status ? 'border-ring/60 bg-accent-muted/40' : 'border-border',
            )}
            aria-label={meta.label}
            onDragOver={(event) => {
              event.preventDefault();
              setDropTarget({ status, index: visible.length });
            }}
            onDrop={(event) => {
              event.preventDefault();
              commitDrop();
            }}
          >
            <header className="flex h-9 shrink-0 items-center gap-2 px-3">
              <span className={cn('size-2 rounded-full', meta.dot)} />
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {meta.label}
              </h2>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                {columnTasks.length}
              </span>
            </header>

            <div className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
              {visible.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  Sin tareas
                </p>
              )}

              {visible.map((task, index) => {
                const meta2 = TASK_STATUS_META[task.status];
                const overdue = isOverdue(task.dueDate, task.status);
                const showIndicator = dropTarget?.status === status && dropTarget.index === index;

                return (
                  <div key={task.id}>
                    {showIndicator && <div className="mb-1.5 h-0.5 rounded-full bg-accent" />}
                    <article
                      draggable
                      onDragStart={(event) => {
                        setDraggingId(task.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDropTarget(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const position = visible.findIndex((item) => item.id === task.id);
                        setDropTarget({
                          status,
                          index: position === -1 ? visible.length : position,
                        });
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        commitDrop();
                      }}
                      className={cn(
                        'group cursor-grab rounded-md border border-border bg-card p-2.5 shadow-sm',
                        'active:cursor-grabbing',
                        draggingId === task.id && 'opacity-40',
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <PriorityIcon priority={task.priority} className="mt-0.5" />
                        <button
                          type="button"
                          onClick={() => onOpen(task)}
                          className="min-w-0 flex-1 text-left text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {task.title}
                        </button>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className={cn('inline-flex items-center gap-1', meta2.text)}>
                          {meta2.label}
                        </span>

                        {task.subtaskTotal > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <ListTree className="size-3" />
                            {task.subtaskDone}/{task.subtaskTotal}
                          </span>
                        )}

                        {showProject && task.project && (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className="size-2 rounded-[3px]"
                              style={{
                                background:
                                  task.project.color ?? 'hsl(var(--muted-foreground))',
                              }}
                            />
                            {task.project.name}
                          </span>
                        )}

                        {task.dueDate && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1',
                              overdue && 'font-medium text-destructive',
                            )}
                          >
                            <CalendarDays className="size-3" />
                            {formatDueLabel(task.dueDate, task.dueTime)}
                          </span>
                        )}

                        {/* Keyboard-accessible alternative to dragging. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger className="ml-auto rounded p-1 opacity-0 hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
                            <MoveRight className="size-3.5" />
                            <span className="sr-only">Mover «{task.title}»</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Mover a</DropdownMenuLabel>
                            {TASK_STATUSES.map((target) => (
                              <DropdownMenuItem
                                key={target}
                                onClick={() => onMove(task.id, target, Number.MAX_SAFE_INTEGER)}
                                className="gap-2"
                              >
                                <span
                                  className={cn(
                                    'size-2 rounded-full',
                                    TASK_STATUS_META[target].dot,
                                  )}
                                />
                                {TASK_STATUS_META[target].label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </article>
                  </div>
                );
              })}

              {dropTarget?.status === status && dropTarget.index >= visible.length && (
                <div className="h-0.5 rounded-full bg-accent" />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
