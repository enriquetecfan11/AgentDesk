'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, format, isToday, isPast, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bot, CheckCircle2, Clock, Inbox as InboxIcon, Loader2, User } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { CaptureBox } from '@/components/tasks/capture-box';
import { TaskList } from '@/components/tasks/task-row';
import { StatusBadge, BadgeDot } from '@/components/ui/badge-dot';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getHumanActor, listArtifacts, listDelegations, listEvents, listRuns, listTasks,
} from '@/lib/api';
import type { Actor, AgentWithActor, DelegationWithContext, Run, TaskWithRefs, WorkspaceEvent, Artifact } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

export function TodayView() {
  const [mine, setMine] = useState<TaskWithRefs[]>([]);
  const [agentDelegations, setAgentDelegations] = useState<DelegationWithContext[]>([]);
  const [inbox, setInbox] = useState<TaskWithRefs[]>([]);
  const [recentRuns, setRecentRuns] = useState<Run[]>([]);
  const [recentEvents, setRecentEvents] = useState<WorkspaceEvent[]>([]);
  const [reviewArtifacts, setReviewArtifacts] = useState<Artifact[]>([]);
  const [human, setHuman] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [h, myTasks, delegations, inboxTasks, runs, events] = await Promise.all([
        getHumanActor(),
        listTasks({ status: ['backlog', 'in_progress', 'review'], dueTo: format(addDays(new Date(), 7), 'yyyy-MM-dd') }),
        listDelegations({ status: ['pending', 'in_progress'] }),
        listTasks({ inboxOnly: true, includeDone: false }),
        listRuns({}),
        listEvents({ limit: 12 }),
      ]);
      setHuman(h);
      setMine(myTasks.filter((t) => !t.assignee || t.assignee.kind === 'human'));
      setAgentDelegations(delegations);
      setInbox(inboxTasks);
      setRecentRuns(runs.slice(0, 5));
      setRecentEvents(events);
      if (delegations.length > 0) {
        const arts = await Promise.all(delegations.map((d) => listArtifacts({ runId: undefined, taskId: d.task_id })));
        setReviewArtifacts(arts.flat().slice(0, 6));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = mine.filter((t) => t.due_date && isToday(parseISO(t.due_date + 'T12:00:00')));
  const overdue = mine.filter((t) => t.due_date && t.status !== 'done' && isPast(parseISO(t.due_date + 'T23:59:59')) && !isToday(parseISO(t.due_date + 'T12:00:00')));
  const upcoming = mine.filter((t) => !t.due_date);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar
        title="Hoy"
        subtitle={format(new Date(), "EEEE d 'de' MMMM", { locale: es })}
      />
      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-6">
          <CaptureBox placeholder="Captura rápida (usa #proyecto, !prioridad, mañana…)" />

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <Section
                icon={<User className="h-3.5 w-3.5" />}
                title="Lo tuyo"
                count={mine.length}
                emptyText="Sin tareas tuyas para los próximos 7 días"
                badge={human?.display_name ?? 'Yo'}
                badgeColor="#22c55e"
              >
                {overdue.length > 0 && (
                  <div className="mb-2">
                    <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-destructive">
                      Vencidas ({overdue.length})
                    </div>
                    <TaskList tasks={overdue} />
                  </div>
                )}
                {today.length > 0 && (
                  <div className="mb-2">
                    <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-warning">
                      Hoy ({today.length})
                    </div>
                    <TaskList tasks={today} />
                  </div>
                )}
                {upcoming.length > 0 && (
                  <div>
                    <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Próximas / sin fecha ({upcoming.length})
                    </div>
                    <TaskList tasks={upcoming} />
                  </div>
                )}
              </Section>

              <Section
                icon={<Bot className="h-3.5 w-3.5" />}
                title="Lo que hacen los agentes"
                count={agentDelegations.length}
                emptyText="No hay delegaciones en curso"
                badge="Agentes"
                badgeColor="#d97706"
              >
                <div className="divide-y">
                  {agentDelegations.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => router.push(`/tasks?open=${d.task_id}`)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60"
                    >
                      <BadgeDot color={(d.agent as unknown as AgentWithActor | null)?.actor?.color ?? '#d97706'} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{d.brief}</span>
                      <StatusBadge
                        label={d.status === 'in_progress' ? 'En curso' : 'Pendiente'}
                        color={d.status === 'in_progress' ? '#f59e0b' : '#6b7280'}
                      />
                      <span className="hidden text-[11px] text-muted-foreground sm:inline">{d.agent?.name}</span>
                    </button>
                  ))}
                </div>
              </Section>

              <Section
                icon={<InboxIcon className="h-3.5 w-3.5" />}
                title="Entró en el Inbox"
                count={inbox.length}
                emptyText="Inbox vacío"
                badge={`${inbox.length} pendientes`}
                badgeColor="#3b82f6"
              >
                <TaskList tasks={inbox.slice(0, 6)} showProject={false} />
              </Section>

              {recentRuns.length > 0 && (
                <Section
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  title="Últimas ejecuciones"
                  count={recentRuns.length}
                  emptyText=""
                  badge="Runs"
                  badgeColor="#6b7280"
                >
                  <div className="divide-y">
                    {recentRuns.map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                        <StatusBadge
                          label={r.status === 'succeeded' ? 'Éxito' : r.status === 'failed' ? 'Fallo' : r.status === 'running' ? 'Ejecutando' : 'Iniciado'}
                          color={r.status === 'succeeded' ? '#22c55e' : r.status === 'failed' ? '#ef4444' : '#f59e0b'}
                        />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {r.summary ?? 'Sin resumen todavía'}
                        </span>
                        {r.duration_ms != null && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">{(r.duration_ms / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              <Section
                icon={<Clock className="h-3.5 w-3.5" />}
                title="Actividad reciente"
                count={recentEvents.length}
                emptyText="Sin actividad todavía"
                badge="Timeline"
                badgeColor="#6b7280"
              >
                <div className="divide-y">
                  {recentEvents.slice(0, 8).map((e) => (
                    <div key={e.id} className="flex items-center gap-2.5 px-3 py-1.5 text-[12px]">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        <EventDescription event={e} />
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(e.created_at), { locale: es, addSuffix: true })}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon, title, count, emptyText, children, badge, badgeColor,
}: {
  icon: React.ReactNode; title: string; count: number; emptyText: string;
  children: React.ReactNode; badge: string; badgeColor: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-muted-foreground">{icon}</span>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <span
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ background: `${badgeColor}1a`, color: badgeColor, border: `1px solid ${badgeColor}33` }}
        >
          <BadgeDot color={badgeColor} className="h-1.5 w-1.5" />
          {badge}
        </span>
        <span className="ml-1 text-[11px] text-muted-foreground">{count}</span>
      </div>
      {count === 0 && emptyText ? (
        <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="py-1">{children}</div>
      )}
    </section>
  );
}

function EventDescription({ event }: { event: WorkspaceEvent }) {
  const actor = event.actor?.display_name ?? event.actor?.name ?? 'Alguien';
  const title = event.entity_title ?? event.entity_type;
  const kind = event.kind.replace('_', ' ');
  return (
    <span>
      <span className="font-medium text-foreground">{actor}</span> · {kind} · {title}
    </span>
  );
}
