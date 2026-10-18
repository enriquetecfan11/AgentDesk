/**
 * Client-safe constants and display metadata.
 *
 * This module must never import anything with `server-only`, because it is used
 * by both Server and Client Components.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

// ---------------------------------------------------------------------------
// Task statuses
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
] as const;

export type TaskStatusValue = (typeof TASK_STATUSES)[number];

/** Column order for the board. */
export const BOARD_STATUSES: TaskStatusValue[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
];

export const TASK_STATUS_META: Record<
  TaskStatusValue,
  { label: string; dot: string; text: string; ring: string }
> = {
  backlog: {
    label: 'Backlog',
    dot: 'bg-zinc-400',
    text: 'text-zinc-600 dark:text-zinc-400',
    ring: 'ring-zinc-400/30',
  },
  todo: {
    label: 'Por hacer',
    dot: 'bg-slate-500',
    text: 'text-slate-600 dark:text-slate-400',
    ring: 'ring-slate-500/30',
  },
  in_progress: {
    label: 'En curso',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
    ring: 'ring-amber-500/30',
  },
  review: {
    label: 'Revisión',
    dot: 'bg-violet-500',
    text: 'text-violet-600 dark:text-violet-400',
    ring: 'ring-violet-500/30',
  },
  done: {
    label: 'Hecho',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-500',
    ring: 'ring-emerald-500/30',
  },
  cancelled: {
    label: 'Cancelado',
    dot: 'bg-zinc-300 dark:bg-zinc-600',
    text: 'text-muted-foreground line-through',
    ring: 'ring-zinc-400/20',
  },
};

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export const TASK_PRIORITIES = ['urgent', 'high', 'normal', 'low', 'none'] as const;

export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_META: Record<
  TaskPriorityValue,
  { label: string; dot: string; text: string }
> = {
  urgent: { label: 'Urgente', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  high: { label: 'Alta', dot: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400' },
  normal: { label: 'Normal', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  low: { label: 'Baja', dot: 'bg-zinc-400', text: 'text-zinc-500' },
  none: { label: 'Sin prioridad', dot: 'bg-transparent', text: 'text-muted-foreground' },
};

export const PROJECT_STATUS_META: Record<
  'active' | 'paused' | 'completed' | 'archived',
  { label: string }
> = {
  active: { label: 'Activo' },
  paused: { label: 'En pausa' },
  completed: { label: 'Completado' },
  archived: { label: 'Archivado' },
};

export const PROJECT_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#64748b',
] as const;
