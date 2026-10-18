'use client';

import {
  ArrowLeft,
  Bot,
  Check,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  PlayCircle,
  ScrollText,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { DelegateDialog } from '@/components/agents/delegate-dialog';
import { NewTokenDialog } from '@/components/agents/token-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_STATUS_META, DELEGATION_STATUS_META, RUN_STATUS_META } from '@/lib/constants';
import { copyText } from '@/lib/clipboard';
import { api } from '@/lib/api-client';
import { formatRelative, formatTimestamp } from '@/lib/dates';
import { scopeLabel } from '@/lib/agent-token';
import type { AgentDTO, ApiTokenDTO, DelegationDTO, RunDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AgentDetail({
  agent,
  tokens,
  delegations,
  runs,
  tasks,
  baseUrl,
}: {
  agent: AgentDTO;
  tokens: ApiTokenDTO[];
  delegations: DelegationDTO[];
  runs: RunDTO[];
  tasks: { id: string; title: string; status: string }[];
  baseUrl: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusMeta = AGENT_STATUS_META[agent.status];

  async function changeStatus(status: AgentDTO['status']) {
    try {
      await api.patch(`/api/agents/${agent.id}`, { status });
      toast.success(`Estado: ${AGENT_STATUS_META[status].label}`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado');
    }
  }

  async function deleteAgent() {
    try {
      await api.del(`/api/agents/${agent.id}`);
      toast.success('Agente eliminado');
      router.push('/agents');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
    }
  }

  async function revokeToken(token: ApiTokenDTO) {
    setBusyId(token.id);
    try {
      await api.del(`/api/tokens/${token.id}`);
      toast.success(`Token ${token.tokenPrefix}… revocado`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo revocar');
    } finally {
      setBusyId(null);
    }
  }

  async function review(delegation: DelegationDTO, action: 'approve' | 'cancel') {
    setBusyId(delegation.id);
    try {
      await api.patch(`/api/delegations/${delegation.id}`, { action });
      toast.success(action === 'approve' ? 'Delegación aprobada' : 'Delegación cancelada');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar');
    } finally {
      setBusyId(null);
    }
  }

  const openDelegations = delegations.filter((delegation) =>
    ['pending', 'accepted', 'in_progress'].includes(delegation.status),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-5">
      <div>
        <Link
          href="/agents"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Agentes
        </Link>
      </div>

      <header className="flex flex-wrap items-start gap-3">
        <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted">
          <Bot className="size-4 text-muted-foreground" />
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">{agent.name}</h1>
          {agent.description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{agent.description}</p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Sin descripción</p>
          )}

          {agent.capabilities.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {agent.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {capability}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('size-2 rounded-full', statusMeta.dot)} aria-hidden />
          <Select value={agent.status} onValueChange={(value) => void changeStatus(value as AgentDTO['status'])}>
            <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="Estado del agente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AGENT_STATUS_META) as AgentDTO['status'][]).map((status) => (
                <SelectItem key={status} value={status} className="text-xs">
                  {AGENT_STATUS_META[status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <EditAgentDialog agent={agent} />

          <DelegateDialog
            agentId={agent.id}
            agentName={agent.name}
            tasks={tasks}
            onCreated={() => router.refresh()}
          />

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground hover:text-destructive"
                aria-label="Eliminar agente"
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar «{agent.name}»?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se eliminan también sus tokens, sus delegaciones y el historial de runs. Los runs
                  quedan fuera de la actividad, pero las tareas que tenía asignadas no se tocan.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => void deleteAgent()}>Eliminar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <QuickStart baseUrl={baseUrl} />

      <Section
        icon={<KeyRound className="size-4 text-muted-foreground" />}
        title="Tokens"
        description="Cada token tiene sus scopes. Solo se ve el prefijo: el valor se muestra una vez al crearlo."
        action={<NewTokenDialog agentId={agent.id} onCreated={() => router.refresh()} />}
      >
        {tokens.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Este agente no tiene tokens: sin uno no puede llamar a la API.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((token) => {
              const revoked = token.revokedAt !== null;

              return (
                <li key={token.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <code
                    className={cn(
                      'font-mono text-xs',
                      revoked && 'text-muted-foreground line-through',
                    )}
                  >
                    {token.tokenPrefix}…
                  </code>
                  <span className="text-xs text-muted-foreground">{token.name}</span>

                  <ul className="flex flex-wrap gap-1">
                    {token.scopes.map((scope) => (
                      <li
                        key={scope}
                        className="rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                        title={scopeLabel(scope)}
                      >
                        {scope}
                      </li>
                    ))}
                  </ul>

                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {revoked
                      ? `revocado ${formatRelative(token.revokedAt!)}`
                      : token.lastUsedAt
                        ? `usado ${formatRelative(token.lastUsedAt)}`
                        : 'sin usar'}
                  </span>

                  {!revoked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      disabled={busyId === token.id}
                      onClick={() => void revokeToken(token)}
                    >
                      {busyId === token.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        'Revocar'
                      )}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        icon={<ScrollText className="size-4 text-muted-foreground" />}
        title="Delegaciones"
        description={
          openDelegations.length > 0
            ? `${openDelegations.length} abiertas de ${delegations.length}`
            : 'Ninguna abierta'
        }
      >
        {delegations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Todavía no se le ha delegado nada.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {delegations.map((delegation) => {
              const meta = DELEGATION_STATUS_META[delegation.status];
              const needsApproval =
                delegation.requiresApproval &&
                delegation.approvedAt === null &&
                delegation.status === 'pending';

              return (
                <li key={delegation.id} className="flex flex-wrap items-start gap-2 px-3 py-2">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', meta.dot)} aria-hidden />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{delegation.title}</p>
                    {delegation.instructions && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {delegation.instructions}
                      </p>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      <span className={meta.text}>{meta.label}</span>
                      {delegation.task && (
                        <span className="truncate">tarea: {delegation.task.title}</span>
                      )}
                      <span>{formatRelative(delegation.createdAt)}</span>
                    </p>
                  </div>

                  {needsApproval && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-[11px]"
                        disabled={busyId === delegation.id}
                        onClick={() => void review(delegation, 'approve')}
                      >
                        <Check className="size-3.5" />
                        Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-[11px] text-muted-foreground"
                        disabled={busyId === delegation.id}
                        onClick={() => void review(delegation, 'cancel')}
                      >
                        <X className="size-3.5" />
                        Rechazar
                      </Button>
                    </div>
                  )}

                  {!needsApproval && ['pending', 'accepted', 'in_progress'].includes(delegation.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-muted-foreground"
                      disabled={busyId === delegation.id}
                      onClick={() => void review(delegation, 'cancel')}
                    >
                      Cancelar
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        icon={<PlayCircle className="size-4 text-muted-foreground" />}
        title="Runs"
        description={`${agent.activeRuns} en curso`}
        action={
          <Link
            href={`/runs?agentId=${agent.id}`}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Ver todos
          </Link>
        }
      >
        {runs.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Sin ejecuciones registradas.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {runs.slice(0, 8).map((run) => {
              const meta = RUN_STATUS_META[run.status];

              return (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50"
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', meta.dot)} aria-hidden />
                    <span className={cn('text-xs', meta.text)}>{meta.label}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {run.task?.title ?? run.id.slice(0, 8)}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)} s` : ''}
                      {run.logCount > 0 && ` · ${run.logCount} logs`}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatTimestamp(run.createdAt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {icon}
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-[11px] text-muted-foreground">{description}</p>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** The three commands an agent needs to get started, ready to copy. */
function QuickStart({ baseUrl }: { baseUrl: string }) {
  const [copied, setCopied] = useState(false);

  const snippet = [
    `export AD_TOKEN="agt_..."`,
    `# ¿Quién soy y qué tengo pendiente?`,
    `curl -s -H "Authorization: Bearer $AD_TOKEN" ${baseUrl}/api/v1/queue | jq`,
    `# Aceptar y reportar`,
    `curl -s -X PATCH -H "Authorization: Bearer $AD_TOKEN" -H 'Content-Type: application/json' \\`,
    `  -d '{"status":"in_progress"}' ${baseUrl}/api/v1/delegations/<id> | jq`,
  ].join('\n');

  return (
    <section className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Send className="size-3.5 text-muted-foreground" />
        <h2 className="text-xs font-medium">Cómo lo usa el agente</h2>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
          onClick={async () => {
            const ok = await copyText(snippet);
            setCopied(ok);
            toast[ok ? 'success' : 'error'](ok ? 'Comandos copiados' : 'No se pudo copiar');
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          Copiar
        </Button>
      </div>
      <pre className="overflow-x-auto text-[11px] leading-relaxed">
        <code className="font-mono">{snippet}</code>
      </pre>
    </section>
  );
}

function EditAgentDialog({ agent }: { agent: AgentDTO }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description ?? '');
  const [capabilities, setCapabilities] = useState(agent.capabilities.join(', '));
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length === 0) {
      toast.error('El nombre es obligatorio');
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/api/agents/${agent.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        capabilities: capabilities
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      });
      toast.success('Agente actualizado');
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo actualizar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-label="Editar agente"
      >
        <Pencil className="size-4" />
      </Button>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar agente</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-name">Nombre</Label>
            <Input
              id="edit-agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-description">Descripción</Label>
            <Textarea
              id="edit-agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-agent-capabilities">Capacidades</Label>
            <Input
              id="edit-agent-capabilities"
              value={capabilities}
              onChange={(event) => setCapabilities(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Separadas por comas.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
