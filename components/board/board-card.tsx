'use client';

import { Bot, CalendarDays, GripVertical, ListTree, MoveRight, User } from 'lucide-react';
import type { DragEvent } from 'react';

import { useTouchDrag } from '@/components/board/use-touch-drag';
import { PriorityIcon } from '@/components/tasks/task-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TASK_STATUSES, TASK_STATUS_META } from '@/lib/constants';
import type { TaskStatusValue } from '@/lib/constants';
import { formatDueLabel, isOverdue } from '@/lib/dates';
import type { TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

function formatLease(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Compact card for the `/board` screen.
 *
 * Hierarchy: title first, then a single wrapping meta line (agent, due date,
 * labels, subtasks). The live lease stays visible without hover because an
 * agent holding the task is the most time-sensitive fact on the board.
 */
export function BoardCard({
  task,
  onOpen,
  onMove,
  dragging,
  onDragStart,
  onDragEnd,
  onCardDragOver,
  showDropBefore,
  onDrop,
  onTouchStart,
  onTouchMove,
  onTouchDrop,
  onTouchCancel,
}: {
  task: TaskDTO;
  onOpen: (task: TaskDTO) => void;
  /** Keyboard alternative to dragging, within the same project board. */
  onMove: (status: TaskStatusValue) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onCardDragOver: (event: DragEvent<HTMLElement>) => void;
  showDropBefore: boolean;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  /** Touch screens drag from the grip, because native DnD ignores touch. */
  onTouchStart: () => void;
  onTouchMove: (x: number, y: number) => void;
  onTouchDrop: (x: number, y: number) => void;
  onTouchCancel: () => void;
}) {
  const touchDrag = useTouchDrag({
    onStart: onTouchStart,
    onMove: onTouchMove,
    onDrop: onTouchDrop,
    onCancel: onTouchCancel,
  });
  const overdue = isOverdue(task.dueDate, task.status);
  const leaseLive =
    task.claimedByAgentId !== null &&
    task.leaseSecondsLeft !== null &&
    task.leaseSecondsLeft > 0;
  const visibleLabels = task.labels.slice(0, 2);
  const hiddenLabels = task.labels.length - visibleLabels.length;

  return (
    <>
      {showDropBefore && <div className="mb-1 h-0.5 rounded-full bg-accent" />}
      <article
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', task.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onCardDragOver(event);
        }}
        onDrop={onDrop}
        className={cn(
          'group cursor-grab rounded-md border border-border bg-card p-2 shadow-sm transition-colors',
          'hover:border-muted-foreground/30 active:cursor-grabbing',
          dragging && 'opacity-40',
        )}
      >
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            aria-label={`Mover «${task.title}»`}
            className="mt-0.5 hidden shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground active:cursor-grabbing [@media(pointer:coarse)]:inline-flex"
            {...touchDrag}
          >
            <GripVertical className="size-3.5" />
          </button>
          <PriorityIcon priority={task.priority} className="mt-0.5 shrink-0" />
          <button
            type="button"
            onClick={() => onOpen(task)}
            className="line-clamp-2 min-w-0 flex-1 text-left text-[13px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {task.title}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 max-sm:opacity-100">
              <MoveRight className="size-3.5" />
              <span className="sr-only">Mover «{task.title}»</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mover a</DropdownMenuLabel>
              {TASK_STATUSES.map((target) => (
                <DropdownMenuItem key={target} onClick={() => onMove(target)} className="gap-2">
                  <span className={cn('size-2 rounded-full', TASK_STATUS_META[target].dot)} />
                  {TASK_STATUS_META[target].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {(leaseLive ||
          task.assigneeType ||
          task.dueDate ||
          task.subtaskTotal > 0 ||
          task.labels.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            {leaseLive && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                title={`Lease de ${task.claimedByAgentName ?? 'un agente'} · ${formatLease(
                  task.leaseSecondsLeft ?? 0,
                )} restantes`}
              >
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                {task.claimedByAgentName ?? 'Agente'}
              </span>
            )}

            {task.assigneeType && (
              <span className="inline-flex max-w-full items-center gap-1 truncate">
                {task.assigneeType === 'agent' ? (
                  <Bot className="size-3 shrink-0" />
                ) : (
                  <User className="size-3 shrink-0" />
                )}
                <span className="truncate">
                  {task.assigneeName ?? (task.assigneeType === 'human' ? 'Yo' : 'Agente')}
                </span>
              </span>
            )}

            {task.dueDate && (
              <span
                className={cn(
                  'inline-flex items-center gap-1',
                  overdue && 'font-medium text-destructive',
                )}
              >
                <CalendarDays className="size-3 shrink-0" />
                {formatDueLabel(task.dueDate, task.dueTime)}
              </span>
            )}

            {visibleLabels.map((label) => (
              <span
                key={label.id}
                className="inline-flex max-w-full items-center gap-1 truncate rounded border border-border px-1 py-px text-[10px]"
              >
                <span
                  className="size-1.5 shrink-0 rounded-[2px]"
                  style={{ background: label.color ?? 'hsl(var(--muted-foreground))' }}
                />
                <span className="truncate">{label.name}</span>
              </span>
            ))}
            {hiddenLabels > 0 && <span className="text-[10px]">+{hiddenLabels}</span>}

            {task.subtaskTotal > 0 && (
              <span className="inline-flex items-center gap-1">
                <ListTree className="size-3 shrink-0" />
                {task.subtaskDone}/{task.subtaskTotal}
              </span>
            )}
          </div>
        )}
      </article>
    </>
  );
}
