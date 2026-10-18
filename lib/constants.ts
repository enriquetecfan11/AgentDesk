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

/** Statuses that count as "still open", used by Hoy, Próximas and the badges. */
export const OPEN_TASK_STATUSES: TaskStatusValue[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
];

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

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const AGENT_STATUSES = ['active', 'paused', 'archived'] as const;
export type AgentStatusValue = (typeof AGENT_STATUSES)[number];

export const AGENT_STATUS_META: Record<
  AgentStatusValue,
  { label: string; dot: string; text: string }
> = {
  active: { label: 'Activo', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-500' },
  paused: { label: 'En pausa', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' },
  archived: {
    label: 'Archivado',
    dot: 'bg-zinc-400',
    text: 'text-muted-foreground',
  },
};

// ---------------------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------------------

export const DELEGATION_STATUSES = [
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'failed',
  'rejected',
  'cancelled',
] as const;
export type DelegationStatusValue = (typeof DELEGATION_STATUSES)[number];

export const DELEGATION_STATUS_META: Record<
  DelegationStatusValue,
  { label: string; dot: string; text: string }
> = {
  pending: { label: 'Pendiente', dot: 'bg-zinc-400', text: 'text-muted-foreground' },
  accepted: { label: 'Aceptada', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  in_progress: {
    label: 'En curso',
    dot: 'bg-amber-500',
    text: 'text-amber-600 dark:text-amber-500',
  },
  completed: {
    label: 'Completada',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-500',
  },
  failed: { label: 'Fallida', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  rejected: { label: 'Rechazada', dot: 'bg-red-400', text: 'text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelada', dot: 'bg-zinc-300 dark:bg-zinc-600', text: 'text-muted-foreground' },
};

/** Delegations an agent still has to act on. */
export const OPEN_DELEGATION_STATUSES: DelegationStatusValue[] = [
  'pending',
  'accepted',
  'in_progress',
];

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatusValue = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_META: Record<
  RunStatusValue,
  { label: string; dot: string; text: string }
> = {
  queued: { label: 'En cola', dot: 'bg-zinc-400', text: 'text-muted-foreground' },
  running: { label: 'Ejecutando', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-500' },
  succeeded: {
    label: 'Correcta',
    dot: 'bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-500',
  },
  failed: { label: 'Fallida', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  cancelled: { label: 'Cancelada', dot: 'bg-zinc-300 dark:bg-zinc-600', text: 'text-muted-foreground' },
};

/** Statuses that close a run; a run in one of these never changes again. */
export const TERMINAL_RUN_STATUSES: RunStatusValue[] = ['succeeded', 'failed', 'cancelled'];

export const RUN_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type RunLogLevelValue = (typeof RUN_LOG_LEVELS)[number];

export const RUN_LOG_LEVEL_META: Record<RunLogLevelValue, { label: string; text: string }> = {
  debug: { label: 'debug', text: 'text-muted-foreground' },
  info: { label: 'info', text: 'text-foreground' },
  warn: { label: 'warn', text: 'text-amber-600 dark:text-amber-500' },
  error: { label: 'error', text: 'text-red-600 dark:text-red-400' },
};

export const ARTIFACT_KINDS = ['file', 'text', 'url'] as const;
export type ArtifactKindValue = (typeof ARTIFACT_KINDS)[number];
