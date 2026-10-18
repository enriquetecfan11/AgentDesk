'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bot, Check, Copy, KeyRound, Loader2, Plus, Power, Trash2 } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { AutomationsSection } from '@/components/agents/automations-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BadgeDot, StatusBadge, OriginBadge } from '@/components/ui/badge-dot';
import { createAgent, deleteAgent, listAgents, listDelegations, listEvents, listRuns, updateAgent } from '@/lib/api';
import type { AgentWithActor, DelegationWithContext, Run, WorkspaceEvent } from '@/lib/types';
import { AGENT_KINDS } from '@/lib/types';

export function AgentsView() {
  const [agents, setAgents] = useState<AgentWithActor[]>([]);
  const [selected, setSelected] = useState<AgentWithActor | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', kind: 'executor' });
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);

  const [delegations, setDelegations] = useState<DelegationWithContext[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await listAgents();
      setAgents(a);
      setSelected((s) => (s ? a.find((x) => x.id === s.id) ?? a[0] ?? null : a[0] ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selected) return;
    Promise.all([
      listDelegations({ agentId: selected.id }),
      listRuns({ agentId: selected.id }),
      listEvents({ actorId: selected.actor_id ?? undefined, limit: 20 }),
    ]).then(([d, r, e]) => {
      setDelegations(d);
      setRuns(r);
      setEvents(e);
    }).catch(() => {});
  }, [selected]);

  const create = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      const { agent, token } = await createAgent({ name: form.name.trim(), description: form.description.trim() || null, kind: form.kind as 'organizer' | 'executor' | 'analyst' });
      setNewToken({ name: agent.name, token });
      setForm({ name: '', description: '', kind: 'executor' });
      setCreating(false);
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (agent: AgentWithActor) => {
    await updateAgent(agent.id, { status: agent.status === 'active' ? 'paused' : 'active' });
    load();
  };

  const remove = async (agent: AgentWithActor) => {
    await deleteAgent(agent.id, agent.actor_id);
    setSelected(null);
    load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar
        title="Agentes"
        subtitle={`${agents.length} registrados`}
        actions={
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setCreating((c) => !c)}>
            <Plus className="h-3.5 w-3.5" /> Registrar
          </Button>
        }
      />

      {newToken && (
        <div className="space-y-2 border-b border-[hsl(var(--ring))] bg-accent-muted/60 p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <KeyRound className="h-4 w-4 text-accent" />
            Token de {newToken.name} — cópialo ahora, no se volverá a mostrar
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-card px-3 py-2 font-mono text-[12px]">
              {newToken.token}
            </code>
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => navigator.clipboard.writeText(newToken.token)}>
              <Copy className="h-3.5 w-3.5" /> Copiar
            </Button>
            <Button size="sm" className="h-9 gap-1.5" onClick={() => setNewToken(null)}>
              <Check className="h-3.5 w-3.5" /> Listo
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border p-3">
          {creating && (
            <div className="mb-3 space-y-2 rounded-lg border border-border bg-card p-3">
              <Input placeholder="Nombre del agente" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="text-[13px]" />
              <Textarea placeholder="Descripción / capacidades (opcional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="min-h-[50px] text-[12px]" />
              <Tabs value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v }))}>
                <TabsList className="h-7 w-full">
                  {AGENT_KINDS.map((k) => (
                    <TabsTrigger key={k.value} value={k.value} className="h-6 flex-1 px-1 text-[11px]">{k.label}</TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Button size="sm" className="h-8 w-full gap-1.5" disabled={busy || !form.name.trim()} onClick={create}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                Registrar agente
              </Button>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : agents.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              Sin agentes. Registra el primero para poder delegar trabajo.
            </p>
          ) : (
            <div className="space-y-1">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left hover:bg-muted/60 ${selected?.id === a.id ? 'bg-muted' : ''}`}
                >
                  <BadgeDot color={a.actor?.color ?? '#d97706'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{a.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {AGENT_KINDS.find((k) => k.value === a.kind)?.label} · {a.status === 'active' ? 'activo' : 'pausado'}
                    </div>
                  </div>
                  <Power
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); toggle(a); }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Bot className="h-8 w-8" />
              <p className="text-sm">Selecciona un agente para ver su historial y trazabilidad.</p>
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-5">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2">
                  <BadgeDot color={selected.actor?.color ?? '#d97706'} />
                  <h2 className="text-[15px] font-semibold">{selected.name}</h2>
                  <StatusBadge
                    label={selected.status === 'active' ? 'Activo' : 'Pausado'}
                    color={selected.status === 'active' ? '#22c55e' : '#6b7280'}
                  />
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[11px]" onClick={() => toggle(selected)}>
                      <Power className="h-3 w-3" />
                      {selected.status === 'active' ? 'Pausar' : 'Activar'}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px] text-destructive" onClick={() => remove(selected)}>
                      <Trash2 className="h-3 w-3" /> Eliminar
                    </Button>
                  </div>
                </div>
                {selected.description && (
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{selected.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono">actor: {selected.actor_id?.slice(0, 8)}</span>
                  <span>Permisos: {selected.permissions.join(', ')}</span>
                </div>
              </div>

              <section>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delegaciones ({delegations.length})</h3>
                <div className="rounded-lg border border-border bg-card">
                  {delegations.length === 0 ? (
                    <p className="py-6 text-center text-[12px] text-muted-foreground">Sin delegaciones para este agente</p>
                  ) : (
                    <div className="divide-y">
                      {delegations.slice(0, 10).map((d) => (
                        <button
                          key={d.id}
                          onClick={() => router.push(`/tasks?open=${d.task_id}`)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px]">{d.brief}</span>
                          <StatusBadge
                            label={d.status === 'in_progress' ? 'En curso' : d.status === 'pending' ? 'Pendiente' : d.status === 'completed' ? 'Completada' : d.status === 'failed' ? 'Fallida' : 'Cancelada'}
                            color={d.status === 'completed' ? '#22c55e' : d.status === 'failed' ? '#ef4444' : d.status === 'in_progress' ? '#f59e0b' : '#6b7280'}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Ejecuciones ({runs.length})</h3>
                <div className="rounded-lg border border-border bg-card">
                  {runs.length === 0 ? (
                    <p className="py-6 text-center text-[12px] text-muted-foreground">Este agente aún no ha ejecutado nada</p>
                  ) : (
                    <div className="divide-y">
                      {runs.slice(0, 10).map((r) => (
                        <div key={r.id} className="px-3 py-2">
                          <div className="flex items-center gap-2.5">
                            <StatusBadge
                              label={r.status === 'succeeded' ? 'Éxito' : r.status === 'failed' ? 'Fallo' : r.status === 'running' ? 'Ejecutando' : 'Iniciado'}
                              color={r.status === 'succeeded' ? '#22c55e' : r.status === 'failed' ? '#ef4444' : '#f59e0b'}
                            />
                            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{r.summary ?? r.error ?? 'Sin resumen'}</span>
                            {r.duration_ms != null && (
                              <span className="shrink-0 text-[10px] text-muted-foreground">{(r.duration_ms / 1000).toFixed(1)}s</span>
                            )}
                            <span className="shrink-0 text-[10px] text-muted-foreground/70">
                              {formatDistanceToNow(new Date(r.started_at), { locale: es, addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <AutomationsSection />
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Actividad</h3>
                <div className="rounded-lg border border-border bg-card">
                  {events.length === 0 ? (
                    <p className="py-6 text-center text-[12px] text-muted-foreground">Sin eventos registrados</p>
                  ) : (
                    <div className="divide-y">
                      {events.map((e) => (
                        <div key={e.id} className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]">
                          <span className="min-w-0 flex-1 truncate">
                            {e.kind.replace(/[_.]/g, ' ')}
                            {e.entity_title && <> · {e.entity_title}</>}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/70">
                            {format(new Date(e.created_at), 'd MMM HH:mm', { locale: es })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
