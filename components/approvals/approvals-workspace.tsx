'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ApprovalDialog, formatCountdown } from '@/components/approvals/approval-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { APPROVAL_STATUSES, APPROVAL_STATUS_META, RISK_META } from '@/lib/constants';
import { formatRelative } from '@/lib/dates';
import type { ApprovalDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const PENDING = '__pending__';
const ALL = '__all__';

/**
 * The inbox of parked actions.
 *
 * Defaults to the pending ones: this is a to-do list, and a list that opens on
 * the archive is a list nobody works through. The decided ones are one filter
 * away, because "what did I say no to, and why" is the other question this
 * screen has to answer.
 */
export function ApprovalsWorkspace({ initialApprovals }: { initialApprovals: ApprovalDTO[] }) {
  const router = useRouter();
  const [approvals, setApprovals] = useState(initialApprovals);
  const [filter, setFilter] = useState<string>(PENDING);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => setApprovals(initialApprovals), [initialApprovals]);

  const filtered = useMemo(() => {
    if (filter === ALL) return approvals;
    if (filter === PENDING) return approvals.filter((approval) => approval.status === 'pending');
    return approvals.filter((approval) => approval.status === filter);
  }, [approvals, filter]);

  const pendingCount = approvals.filter((approval) => approval.status === 'pending').length;
  const selected = approvals.find((approval) => approval.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Aprobaciones</h1>
          <p className="text-xs text-muted-foreground">
            {pendingCount === 0
              ? 'Nada esperando tu decisión'
              : `${pendingCount} esperando tu decisión`}
          </p>
        </div>

        <div className="ml-auto">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PENDING} className="text-xs">
                Esperando
              </SelectItem>
              <SelectItem value={ALL} className="text-xs">
                Todas
              </SelectItem>
              {APPROVAL_STATUSES.filter((value) => value !== 'pending').map((value) => (
                <SelectItem key={value} value={value} className="text-xs">
                  {APPROVAL_STATUS_META[value].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <div className="max-w-md space-y-2">
            <ShieldCheck className="mx-auto size-5 text-muted-foreground" />
            <h2 className="text-sm font-medium">
              {approvals.length === 0 ? 'Todavía no te han pedido nada' : 'Ninguna coincide'}
            </h2>
            <p className="text-xs text-muted-foreground">
              Cuando un agente quiera delegar una tarea, ejecutar algo o enviar algo, aparecerá
              aquí con sus argumentos exactos y no pasará nada hasta que tú decidas.
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <ul className="divide-y divide-border">
            {filtered.map((approval) => {
              const risk = RISK_META[approval.risk];
              const statusMeta = APPROVAL_STATUS_META[approval.status];

              return (
                <li key={approval.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(approval.id)}
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      className={cn('size-2 shrink-0 rounded-full', risk.dot)}
                      aria-hidden
                    />
                    <span className="sr-only">Riesgo {risk.label}.</span>

                    <span className={cn('w-20 shrink-0 text-xs', statusMeta.text)}>
                      {statusMeta.label}
                    </span>

                    <span className="min-w-0 flex-1 truncate text-sm">{approval.title}</span>

                    <code className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {approval.tool}
                    </code>

                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {approval.agent?.name ?? '—'}
                    </span>

                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {approval.status === 'pending'
                        ? formatCountdown(approval.secondsLeft)
                        : formatRelative(approval.decidedAt ?? approval.createdAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ApprovalDialog
        approval={selected}
        open={openId !== null}
        onOpenChange={(next) => setOpenId(next ? openId : null)}
        onDecided={() => router.refresh()}
      />
    </div>
  );
}
