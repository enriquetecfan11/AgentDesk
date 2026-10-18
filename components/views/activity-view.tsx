'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bot, User, Zap } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BadgeDot } from '@/components/ui/badge-dot';
import { listAgents, listEvents } from '@/lib/api';
import type { AgentWithActor, WorkspaceEvent, ActorKind } from '@/lib/types';

export function ActivityView() {
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);
  const [agents, setAgents] = useState<AgentWithActor[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState<string>('all');

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, a] = await Promise.all([
        actorFilter === 'all' ? listEvents({ limit: 200 }) :
          actorFilter === 'human' ? listEvents({ actorId: 'human', limit: 200 }) :
            listEvents({ limit: 200 }),
        listAgents(),
      ]);
      setEvents(e);
      setAgents(a);
    } finally {
      setLoading(false);
    }
  }, [actorFilter]);

  useEffect(() => { load(); }, [load]);

  const humanEvents = events.filter((e) => !e.actor || e.actor.kind === 'human');
  const agentEvents = events.filter((e) => e.actor?.kind === 'agent');
  const automationEvents = events.filter((e) => e.actor?.kind === 'automation');
  const systemEvents = events.filter((e) => e.actor === null && e.entity_type === 'system');

  const filtered = (() => {
    if (actorFilter === 'all') return events;
    if (actorFilter === 'human') return humanEvents;
    if (actorFilter === 'agents') return agentEvents;
    if (actorFilter === 'automations') return automationEvents;
    return events;
  })();

  const kindIcon = (e: WorkspaceEvent) => {
    if (!e.actor) return <Zap className="h-3 w-3 text-muted-foreground/50" />;
    if (e.actor.kind === 'human') return <User className="h-3 w-3 text-success" />;
    if (e.actor.kind === 'agent') return <Bot className="h-3 w-3 text-warning" />;
    return <Zap className="h-3 w-3 text-accent" />;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar title="Actividad" subtitle={`${filtered.length} eventos`} />
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Tabs value={actorFilter} onValueChange={(v) => setActorFilter(v)}>
          <TabsList className="h-7">
            <TabsTrigger value="all" className="h-6 px-2.5 text-xs">Todo</TabsTrigger>
            <TabsTrigger value="human" className="h-6 gap-1 px-2.5 text-xs"><User className="h-3 w-3" /> Yo</TabsTrigger>
            <TabsTrigger value="agents" className="h-6 gap-1 px-2.5 text-xs"><Bot className="h-3 w-3" /> Agentes</TabsTrigger>
            <TabsTrigger value="automations" className="h-6 gap-1 px-2.5 text-xs"><Zap className="h-3 w-3" /> Automatizaciones</TabsTrigger>
          </TabsList>
        </Tabs>
        {actorFilter === 'human' && humanEvents.length > 0 && (
          <span className="text-[11px] text-muted-foreground">eventos del actor humano</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <Zap className="h-8 w-8" />
              <p className="text-sm">Sin actividad todavía. Lo que hagas tú, tus agentes y tus automatizaciones aparecerá aquí.</p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card">
              <div className="divide-y">
                {filtered.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50"
                  >
                    <span className="shrink-0">{kindIcon(e)}</span>
                    {e.actor && <BadgeDot color={e.actor.color} className="h-1.5 w-1.5" />}
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      <span className="font-medium text-foreground">
                        {e.actor?.display_name ?? e.actor?.name ?? (e.actor_id === 'human' ? 'Yo' : 'Sistema')}
                      </span>
                      <span className="text-muted-foreground"> · {e.kind.replace(/[_.]/g, ' ')}</span>
                      {e.entity_title && <span className="text-muted-foreground"> · {e.entity_title}</span>}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/70" title={format(new Date(e.created_at), 'd MMM yyyy HH:mm', { locale: es })}>
                      {formatDistanceToNow(new Date(e.created_at), { locale: es, addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
