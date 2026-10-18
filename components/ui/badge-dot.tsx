import { cn } from '@/lib/utils';

export function BadgeDot({ color, className }: { color: string | null | undefined; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
      style={{ background: color ?? '#6b7280' }}
    />
  );
}

export function StatusBadge({
  label, color, soft,
}: {
  label: string; color: string; soft?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        soft ? 'opacity-80' : '',
      )}
      style={{
        background: soft ? `${color}22` : `${color}2a`,
        color: soft ? color : color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

export function OriginBadge({ origin }: { origin: 'human' | 'agent' | 'automation' }) {
  const map = {
    human: { label: 'Humano', color: '#22c55e' },
    agent: { label: 'Agente', color: '#d97706' },
    automation: { label: 'Automatización', color: '#3b82f6' },
  } as const;
  const { label, color } = map[origin];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: `${color}1f`, color, border: `1px solid ${color}3d` }}
    >
      <BadgeDot color={color} className="h-1.5 w-1.5" />
      {label}
    </span>
  );
}
