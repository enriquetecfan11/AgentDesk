import { Check } from 'lucide-react';

import { TASK_PRIORITY_META, TASK_STATUS_META } from '@/lib/constants';
import type { TaskPriorityValue, TaskStatusValue } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * Status indicator. `cancelled` and `done` reuse the same circle so the column
 * reads as a single progress track.
 */
export function StatusIcon({
  status,
  className,
}: {
  status: TaskStatusValue;
  className?: string;
}) {
  const meta = TASK_STATUS_META[status];
  const isDone = status === 'done';
  const isCancelled = status === 'cancelled';

  return (
    <span
      aria-hidden
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded-full border',
        isDone || isCancelled ? 'border-transparent' : 'border-current',
        meta.text,
        className,
      )}
    >
      {isDone && (
        <span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
      {!isDone && !isCancelled && <span className={cn('size-1.5 rounded-full', meta.dot)} />}
    </span>
  );
}

const PRIORITY_BARS: Record<TaskPriorityValue, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
  none: 0,
};

/** Signal-strength bars, like Linear. Drawn inline so no icon set is needed. */
export function PriorityIcon({
  priority,
  className,
}: {
  priority: TaskPriorityValue;
  className?: string;
}) {
  const meta = TASK_PRIORITY_META[priority];
  const filled = PRIORITY_BARS[priority];

  return (
    <span
      className={cn('inline-flex h-4 w-4 items-end justify-center gap-[2px]', className)}
      title={meta.label}
      role="img"
      aria-label={`Prioridad ${meta.label}`}
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={cn(
            'w-[2.5px] rounded-[1px]',
            index < filled ? meta.dot : 'bg-muted-foreground/20',
          )}
          style={{ height: `${4 + index * 3}px` }}
        />
      ))}
    </span>
  );
}
