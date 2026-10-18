'use client';

import { Check, Loader2, Pencil, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { APPROVAL_STATUS_META, RISK_META } from '@/lib/constants';
import { formatTimestamp } from '@/lib/dates';
import type { ApprovalDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Human-readable countdown; the inbox is read by someone, not by a machine. */
function formatCountdown(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds <= 0) return 'caducada';
  if (seconds < 60) return `caduca en ${seconds} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `caduca en ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `caduca en ${hours} h`;
  return `caduca en ${Math.floor(hours / 24)} días`;
}

/**
 * The decision dialog.
 *
 * The exact payload is always on screen, unedited, above everything else: a
 * summary of what you are approving is not what you are approving. Editing the
 * arguments is a separate, opt-in textarea, so the original stays visible next
 * to the change.
 */
export function ApprovalDialog({
  approval,
  open,
  onOpenChange,
  onDecided,
}: {
  approval: ApprovalDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const original = useMemo(
    () => (approval ? JSON.stringify(approval.payload, null, 2) : '{}'),
    [approval],
  );

  // A different approval means a clean slate: a motive typed for one decision
  // must never ride along to the next.
  useEffect(() => {
    setReason('');
    setEditing(false);
    setDraft(original);
  }, [approval?.id, original]);

  if (!approval) return null;

  const risk = RISK_META[approval.risk];
  const statusMeta = APPROVAL_STATUS_META[approval.status];
  const decided = approval.status !== 'pending';

  async function decide(action: 'approve' | 'reject') {
    if (!approval) return;

    if (action === 'reject' && reason.trim().length === 0) {
      toast.error('Un rechazo necesita un motivo: el agente lo recibe y actúa con él');
      return;
    }

    let payload: Record<string, unknown> | undefined;
    if (action === 'approve' && editing) {
      try {
        const parsed: unknown = JSON.parse(draft);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          toast.error('Los argumentos tienen que ser un objeto JSON');
          return;
        }
        payload = parsed as Record<string, unknown>;
      } catch {
        toast.error('Ese JSON no se puede leer: revísalo antes de aprobar');
        return;
      }
    }

    setBusy(true);
    try {
      await api.patch(`/api/approvals/${approval.id}`, {
        action,
        ...(payload === undefined ? {} : { payload }),
        ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
      });

      toast.success(
        action === 'approve'
          ? payload
            ? 'Aprobada con tus cambios'
            : 'Aprobada'
          : 'Rechazada: el agente recibirá el motivo',
      );
      onDecided();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo decidir');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn('size-2 shrink-0 rounded-full', risk.dot)} aria-hidden />
            <span className="sr-only">Riesgo {risk.label}. </span>
            {approval.title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            <code className="font-mono">{approval.tool}</code> · riesgo {risk.label.toLowerCase()} ·
            pedida por {approval.agent?.name ?? 'un agente'}{' '}
            {approval.task ? (
              <>
                sobre{' '}
                <Link href="/tasks" className="underline underline-offset-2">
                  {approval.task.title}
                </Link>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {approval.summary ? (
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {approval.summary}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs">Lo que te está pidiendo, tal cual</Label>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed">
              {original}
            </pre>
            <p className="text-[11px] text-muted-foreground">
              AgentDesk no ejecuta esto: si lo apruebas, lo ejecuta el agente.
            </p>
          </div>

          {decided ? (
            <div className="space-y-1 rounded-md border border-border px-3 py-2 text-xs">
              <p>
                <span className={statusMeta.text}>{statusMeta.label}</span>
                {approval.decidedByUserName ? ` por ${approval.decidedByUserName}` : ''}
                {approval.decidedAt ? ` · ${formatTimestamp(approval.decidedAt)}` : ''}
              </p>
              {approval.reason ? (
                <p className="whitespace-pre-wrap text-muted-foreground">{approval.reason}</p>
              ) : null}
              {approval.payloadEdited ? (
                <>
                  <p className="pt-1 font-medium">Argumentos con los que se aprobó</p>
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted/30 px-2 py-1.5 font-mono text-[11px]">
                    {JSON.stringify(approval.payloadEdited, null, 2)}
                  </pre>
                </>
              ) : null}
            </div>
          ) : (
            <>
              {editing ? (
                <div className="space-y-1.5">
                  <Label htmlFor="approval-payload" className="text-xs">
                    Argumentos con los que quieres aprobarlo
                  </Label>
                  <Textarea
                    id="approval-payload"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    className="min-h-40 font-mono text-[11px]"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Lo que escribas aquí es lo que recibirá el agente. Lo que pidió se conserva
                    arriba.
                  </p>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" />
                  Editar los argumentos
                </Button>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="approval-reason" className="text-xs">
                  Motivo o respuesta
                </Label>
                <Textarea
                  id="approval-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Obligatorio si rechazas. El agente lo lee y actúa con él."
                  className="min-h-20 text-xs"
                />
              </div>

              <p className="text-[11px] text-muted-foreground">
                {formatCountdown(approval.secondsLeft)}. Si caduca cuenta como rechazada.
              </p>
            </>
          )}
        </div>

        <DialogFooter>
          {decided ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                className="gap-1.5"
                onClick={() => void decide('reject')}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                Rechazar
              </Button>
              <Button size="sm" disabled={busy} className="gap-1.5" onClick={() => void decide('approve')}>
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {editing ? 'Aprobar con cambios' : 'Aprobar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { formatCountdown };
