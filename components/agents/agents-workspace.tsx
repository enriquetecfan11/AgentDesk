'use client';

import { Bot, Loader2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { AGENT_STATUS_META } from '@/lib/constants';
import { formatTimestamp } from '@/lib/dates';
import type { AgentDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Agents: who exists, what they can do, and whether anything is waiting. */
export function AgentsWorkspace({ initialAgents }: { initialAgents: AgentDTO[] }) {
  const router = useRouter();

  const [agents, setAgents] = useState(initialAgents);
  const [query, setQuery] = useState('');

  useEffect(() => setAgents(initialAgents), [initialAgents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return agents;

    return agents.filter(
      (agent) =>
        agent.name.toLowerCase().includes(needle) ||
        (agent.description ?? '').toLowerCase().includes(needle) ||
        agent.capabilities.some((capability) => capability.toLowerCase().includes(needle)),
    );
  }, [agents, query]);

  const pending = agents.reduce((total, agent) => total + agent.openDelegations, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Agentes</h1>
          <p className="text-xs text-muted-foreground">
            {agents.length === 0
              ? 'Ninguno todavía'
              : `${agents.length} en total${pending > 0 ? ` · ${pending} delegaciones abiertas` : ''}`}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar agentes…"
              aria-label="Buscar agentes"
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
          <NewAgentDialog onCreated={() => router.refresh()} />
        </div>
      </header>

      {filtered.length === 0 ? (
        <EmptyAgents hasAgents={agents.length > 0} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {filtered.map((agent) => {
            const meta = AGENT_STATUS_META[agent.status];

            return (
              <li key={agent.id}>
                <Link
                  href={`/agents/${agent.id}`}
                  className="flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn('size-2 shrink-0 rounded-full', meta.dot)}
                      aria-label={`Estado: ${meta.label}`}
                      role="img"
                    />
                    <span className="truncate text-sm font-medium">{agent.name}</span>
                    <span className={cn('ml-auto text-[11px]', meta.text)}>{meta.label}</span>
                  </div>

                  {agent.description && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {agent.description}
                    </p>
                  )}

                  {agent.capabilities.length > 0 && (
                    <ul className="flex flex-wrap gap-1">
                      {agent.capabilities.slice(0, 4).map((capability) => (
                        <li
                          key={capability}
                          className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {capability}
                        </li>
                      ))}
                      {agent.capabilities.length > 4 && (
                        <li className="px-1 py-0.5 text-[11px] text-muted-foreground">
                          +{agent.capabilities.length - 4}
                        </li>
                      )}
                    </ul>
                  )}

                  <dl className="mt-auto flex items-center gap-3 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <dt className="sr-only">Tokens</dt>
                      <dd>{agent.tokenCount} tokens</dd>
                    </div>
                    {agent.openDelegations > 0 && (
                      <div className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                        <dt className="sr-only">Delegaciones abiertas</dt>
                        <dd>{agent.openDelegations} en cola</dd>
                      </div>
                    )}
                    {agent.activeRuns > 0 && (
                      <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-500">
                        <dt className="sr-only">Runs activos</dt>
                        <dd>{agent.activeRuns} ejecutando</dd>
                      </div>
                    )}
                    {agent.lastRunAt && (
                      <div className="ml-auto flex items-center gap-1">
                        <dt className="sr-only">Último run</dt>
                        <dd>{formatTimestamp(agent.lastRunAt)}</dd>
                      </div>
                    )}
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyAgents({ hasAgents }: { hasAgents: boolean }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-border px-6 py-14 text-center">
      <div className="max-w-md space-y-2">
        <Bot className="mx-auto size-5 text-muted-foreground" />
        <h2 className="text-sm font-medium">{hasAgents ? 'Ninguno coincide' : 'Todavía no hay agentes'}</h2>
        <p className="text-xs text-muted-foreground">
          Un agente es una identidad con su propio token y sus scopes. Con él llama a{' '}
          <code className="font-mono">/api/v1/queue</code> para ver qué tiene pendiente y reporta el
          trabajo en <code className="font-mono">/api/v1/runs</code>.
        </p>
      </div>
    </div>
  );
}

/** Creation lives in its own component so the list stays a list. */
export function NewAgentDialog({
  onCreated,
  label = 'Nuevo agente',
}: {
  onCreated: () => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (name.trim().length === 0) {
      toast.error('El nombre es obligatorio');
      return;
    }

    setBusy(true);
    try {
      const { agent } = await api.post<{ agent: AgentDTO }>('/api/agents', {
        name: name.trim(),
        description: description.trim() || null,
        capabilities: capabilities
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      });

      toast.success(`Agente «${agent.name}» creado`);
      setOpen(false);
      setName('');
      setDescription('');
      setCapabilities('');
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el agente');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        {label}
      </Button>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo agente</DialogTitle>
          <DialogDescription>
            El nombre identifica al agente en la actividad, en las delegaciones y en los runs. El
            token se crea después, desde su ficha.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Nombre</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="p. ej. Wazuh triage"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-description">Descripción</Label>
            <Textarea
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Qué hace y con qué límites"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agent-capabilities">Capacidades</Label>
            <Input
              id="agent-capabilities"
              value={capabilities}
              onChange={(event) => setCapabilities(event.target.value)}
              placeholder="revisar CVEs, escribir informes, proponer parches"
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
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
