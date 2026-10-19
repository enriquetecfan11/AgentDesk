'use client';

import { CalendarDays, GripVertical, ListTree, MoveRight } from 'lucide-react';
import type { DragEvent } from 'react';
import { useState } from 'react';

import { dropZoneAt, useTouchDrag } from '@/components/board/use-touch-drag';
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

  function resetDrag() {
    setDraggingId(null);
    setDropTarget(null);
  }

  function commitDrop() {
    if (draggingId && dropTarget) onMove(draggingId, dropTarget.status, dropTarget.index);
    resetDrag();
  }

  /** Touch has no hover, so it always drops at the end of the column. */
  function touchMove(x: number, y: number) {
    const status = dropZoneAt(x, y)?.dataset.dropStatus as TaskStatusValue | undefined;
    if (status) setDropTarget({ status, index: Number.MAX_SAFE_INTEGER });
  }

  function touchDrop(id: string, x: number, y: number) {
    const status = dropZoneAt(x, y)?.dataset.dropStatus as TaskStatusValue | undefined;
    if (status) onMove(id, status, Number.MAX_SAFE_INTEGER);
    resetDrag();
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-3">
      {BOARD_STATUSES.map((status) => {
        const columnTasks = tasks.filter((task) => task.status === status).sort(bySortOrder);
        // The dragged card stays mounted so a touch pointer keeps its capture;
        // only the drop math ignores it.
        const remaining = columnTasks.filter((task) => task.id !== draggingId);
        const meta = TASK_STATUS_META[status];

        return (
          <section
            key={status}
            data-drop-status={status}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/20',
              dropTarget?.status === status ? 'border-ring/60 bg-accent-muted/40' : 'border-border',
            )}
            aria-label={meta.label}
            onDragOver={(event) => {
              event.preventDefault();
              setDropTarget({ status, index: remaining.length });
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
              {columnTasks.length === 0 && (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  Sin tareas
                </p>
              )}

              {columnTasks.map((task) => {
                const position = remaining.findIndex((item) => item.id === task.id);

                return (
                  <TaskBoardCard
                    key={task.id}
                    task={task}
                    showProject={showProject}
                    dragging={draggingId === task.id}
                    showDropBefore={
                      dropTarget?.status === status &&
                      position !== -1 &&
                      dropTarget.index === position
                    }
                    onOpen={onOpen}
                    onMove={onMove}
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={resetDrag}
                    onCardDragOver={() =>
                      setDropTarget({
                        status,
                        index: position === -1 ? remaining.length : position,
                      })
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      commitDrop();
                    }}
                    onTouchStart={() => {
                      setDraggingId(task.id);
                      setDropTarget({ status, index: Number.MAX_SAFE_INTEGER });
                    }}
                    onTouchMove={touchMove}
                    onTouchDrop={(x, y) => touchDrop(task.id, x, y)}
                    onTouchCancel={resetDrag}
                  />
                );
              })}

              {dropTarget?.status === status && dropTarget.index >= remaining.length && (
                <div className="h-0.5 rounded-full bg-accent" />
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskBoardCard({
  task,
  showProject,
  dragging,
  showDropBefore,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
  onCardDragOver,
  onDrop,
  onTouchStart,
  onTouchMove,
  onTouchDrop,
  onTouchCancel,
}: {
  task: TaskDTO;
  showProject: boolean;
  dragging: boolean;
  showDropBefore: boolean;
  onOpen: (task: TaskDTO) => void;
  onMove: (id: string, status: TaskStatusValue, index: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onCardDragOver: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onTouchStart: () => void;
  onTouchMove: (x: number, y: number) => void;
  onTouchDrop: (x: number, y: number) => void;
  onTouchCancel: () => void;
}) {
  const meta = TASK_STATUS_META[task.status];
  const overdue = isOverdue(task.dueDate, task.status);
  const touchDrag = useTouchDrag({
    onStart: onTouchStart,
    onMove: onTouchMove,
    onDrop: onTouchDrop,
    onCancel: onTouchCancel,
  });

  return (
    <div>
      {showDropBefore && <div className="mb-1.5 h-0.5 rounded-full bg-accent" />}
      <article
        draggable
        onDragStart={(event) => {
          onDragStart();
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', task.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCardDragOver();
        }}
        onDrop={onDrop}
        className={cn(
          'group cursor-grab rounded-md border border-border bg-card p-2.5 shadow-sm',
          'active:cursor-grabbing',
          dragging && 'opacity-40',
        )}
      >
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={`Mover «${task.title}»`}
            className="mt-0.5 hidden shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground active:cursor-grabbing [@media(pointer:coarse)]:inline-flex"
            {...touchDrag}
          >
            <GripVertical className="size-3.5" />
          </button>
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
          <span className={cn('inline-flex items-center gap-1', meta.text)}>{meta.label}</span>

          {task.subtaskTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListTree className="size-3" />
              {task.subtaskDone}/{task.subtaskTotal}
            </span>
          )}

          {task.assigneeType && (
            <span className="inline-flex rounded-full border border-border px-1.5 py-0.5 text-[11px]">
              {task.assigneeName ?? (task.assigneeType === 'human' ? 'Yo' : 'Agente')}
            </span>
          )}

          {showProject && task.project && (
            <span className="inline-flex items-center gap-1">
              <span
                className="size-2 rounded-[3px]"
                style={{
                  background: task.project.color ?? 'hsl(var(--muted-foreground))',
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
            <DropdownMenuTrigger className="ml-auto rounded p-1 opacity-0 hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 max-sm:opacity-100">
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
                    className={cn('size-2 rounded-full', TASK_STATUS_META[target].dot)}
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
}
