'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bot, ChevronRight, Loader2, NotebookPen, Scale, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { BadgeDot, OriginBadge, StatusBadge } from '@/components/ui/badge-dot';
import {
  createDelegation, createNote, deleteTask, listAgents, listArtifacts, listDecisions,
  listDelegations, listNotes, listRuns, listTasks, updateDelegationStatus, updateTask,
} from '@/lib/api';
import type {
  Agent, AgentWithActor, Artifact, Decision, DelegationWithContext, Note, Run, TaskWithRefs,
} from '@/lib/types';
import type { Actor } from '@/lib/types';
import { AGENT_KINDS, TASK_STATUSES, TASK_PRIORITIES, DELEGATION_STATUSES } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Delegations come from the API joined with agents but without their actor; rebuild the color
// from the agents list we already loaded (they carry the actor join).
function withAgentActor(ds: DelegationWithContext[], agents: AgentWithActor[]): DelegationWithAgentActor[] {
  return ds.map((d) => ({
    ...d,
    agent: d.agent ? { ...d.agent, actor: agents.find((a) => a.id === d.agent!.id)?.actor ?? null } : null,
  }));
}

export interface DelegationWithAgentActor extends DelegationWithContext {
  agent: (Agent & { actor: Actor | null }) | null;
}

const AGENT_KIND_LABEL: Record<string, string> = {
  organizer: 'Organizador', executor: 'Ejecutor', analyst: 'Analista',
};

export function TaskDetailPanel({
  taskId, onClose, onChanged,
}: {
  taskId: string; onClose: () => void; onChanged?: () => void;
}) {
  const [task, setTask] = useState<TaskWithRefs | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [delegations, setDelegations] = useState<DelegationWithAgentActor[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [agents, setAgents] = useState<AgentWithActor[]>([]);
  const [subtasks, setSubtasks] = useState<TaskWithRefs[]>([]);
  const [loading, setLoading] = useState(true);

  const [delegating, setDelegating] = useState(false);
  const [delForm, setDelForm] = useState({ agentId: '', brief: '', limits: '', criteria: '' });
  const [delBusy, setDelBusy] = useState(false);
  const [delContext, setDelContext] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tasks, taskNotes, taskDelegations, taskAgents, taskDecisions] = await Promise.all([
        listTasks({ includeDone: true }),
        listNotes({ taskId }),
        listDelegations({ taskId }),
        listAgents(),
        listDecisions({ taskId }),
      ]);
      const t = tasks.find((x) => x.id === taskId) ?? null;
      setTask(t);
      setNotes(taskNotes);
      setDelegations(withAgentActor(taskDelegations, taskAgents));
      setAgents(taskAgents);
      setDecisions(taskDecisions);
      setSubtasks(tasks.filter((x) => x.parent_task_id === taskId));
      if (t) {
        const [taskRuns, taskArtifacts] = await Promise.all([
          listRuns({ delegationId: undefined, agentId: undefined }).then((rs) => rs.filter((r) => taskDelegations.some((d) => d.id === r.delegation_id))),
          listArtifacts({ taskId }),
        ]);
        setRuns(taskRuns);
        setArtifacts(taskArtifacts);
      }
      if (!delForm.agentId && taskAgents.length > 0) {
        setDelForm((f) => ({ ...f, agentId: taskAgents[0].id }));
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, delForm.agentId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !delegating) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, delegating]);

  const patch = async (p: Parameters<typeof updateTask>[1]) => {
    setBusy(true);
    try {
      await updateTask(taskId, p);
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const submitDelegation = async () => {
    if (!delForm.agentId || !delForm.brief.trim() || delBusy) return;
    setDelBusy(true);
    try {
      await createDelegation({
        task_id: taskId,
        agent_id: delForm.agentId,
        brief: delForm.brief.trim(),
        limits: delForm.limits.trim() || null,
        completion_criteria: delForm.criteria.trim() || null,
        context: delContext.map((refId) => {
          if (refId.startsWith('note:')) return { kind: 'note' as const, ref_id: refId.slice(5) };
          if (refId.startsWith('decision:')) return { kind: 'decision' as const, ref_id: refId.slice(9) };
          return { kind: 'note' as const, ref_id: refId };
        }),
      });
      await updateTask(taskId, { assignee_id: agents.find((a) => a.id === delForm.agentId)?.actor_id ?? null });
      setDelegating(false);
      setDelForm((f) => ({ ...f, brief: '', limits: '', criteria: '' }));
      setDelContext([]);
      await load();
      onChanged?.();
      router.refresh();
    } finally {
      setDelBusy(false);
    }
  };

  const addNote = async () => {
    if (!newNote.trim() || noteBusy) return;
    setNoteBusy(true);
    try {
      const firstLine = newNote.trim().split('\n')[0].slice(0, 60);
      await createNote({ title: firstLine, body_md: newNote.trim(), task_id: taskId, project_id: task?.project_id ?? null });
      setNewNote('');
      await load();
    } finally {
      setNoteBusy(false);
    }
  };

  const removeTask = async () => {
    setBusy(true);
    try {
      await deleteTask(taskId);
      onChanged?.();
      onClose();
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="flex-1 bg-black/30" onClick={delegating ? undefined : onClose} />
      <div className="flex w-full max-w-lg flex-col overflow-hidden border-l border-border bg-card shadow-2xl">
        {loading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !task ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-muted-foreground">
            <p className="text-sm">Tarea no encontrada.</p>
            <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Detalle de tarea</span>
              <Button variant="ghost" size="icon" className="ml-auto h-7 w-7" onClick={onClose} aria-label="Cerrar">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <div>
                <Textarea
                  defaultValue={task.title}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== task.title) patch({ title: v });
                  }}
                  className="resize-none border-0 bg-transparent p-0 text-[16px] font-semibold leading-snug focus-visible:ring-0"
                  rows={Math.ceil(task.title.length / 50) || 1}
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <OriginBadge origin={task.origin} />
                  {task.project && (
                    <button
                      onClick={() => { onClose(); router.push(`/projects/${task.project_id}`); }}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: task.project.color }} />
                      {task.project.name}
                    </button>
                  )}
                  {task.assignee && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <BadgeDot color={task.assignee.color} className="h-1.5 w-1.5" />
                      {task.assignee.display_name ?? task.assignee.name}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Field label="Estado">
                  <Select value={task.status} onValueChange={(v) => patch({ status: v as typeof task.status })}>
                    <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Prioridad">
                  <Select value={task.priority} onValueChange={(v) => patch({ priority: v as typeof task.priority })}>
                    <SelectTrigger className="h-8 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>{TASK_PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Vence">
                  <Input
                    type="date"
                    defaultValue={task.due_date ?? ''}
                    onChange={(e) => patch({ due_date: e.target.value || null })}
                    className="h-8 text-[12px]"
                  />
                </Field>
              </div>

              <div>
                <Field label="Descripción">
                  <Textarea
                    defaultValue={task.description ?? ''}
                    onBlur={(e) => patch({ description: e.target.value.trim() || null })}
                    placeholder="Añadir descripción…"
                    className="min-h-[60px] text-[13px]"
                  />
                </Field>
              </div>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Delegaciones</h3>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => setDelegating((d) => !d)}>
                    <Bot className="h-3 w-3" /> {delegating ? 'Cancelar' : 'Delegar'}
                  </Button>
                </div>

                {delegating && (
                  <div className="space-y-2.5 rounded-lg border border-[hsl(var(--ring))] bg-muted/50 p-3">
                    <Field label="Agente">
                      <Select value={delForm.agentId} onValueChange={(v) => setDelForm((f) => ({ ...f, agentId: v }))}>
                        <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Elegir agente" /></SelectTrigger>
                        <SelectContent>
                          {agents.length === 0 ? (
                            <div className="px-3 py-2 text-[12px] text-muted-foreground">Sin agentes. Regístralos en la vista Agentes.</div>
                          ) : (
                            agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name} ({AGENT_KIND_LABEL[a.kind] ?? a.kind})
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Brief (qué debe hacer)">
                      <Textarea value={delForm.brief} onChange={(e) => setDelForm((f) => ({ ...f, brief: e.target.value }))} placeholder="Objetivo de la delegación…" className="min-h-[70px] text-[12px]" />
                    </Field>
                    <Field label="Límites (qué no puede hacer)">
                      <Input value={delForm.limits} onChange={(e) => setDelForm((f) => ({ ...f, limits: e.target.value }))} placeholder="Ej: no contactar clientes" className="h-8 text-[12px]" />
                    </Field>
                    <Field label="Criterio de completado">
                      <Input value={delForm.criteria} onChange={(e) => setDelForm((f) => ({ ...f, criteria: e.target.value }))} placeholder="Ej: informe listo con 3 propuestas" className="h-8 text-[12px]" />
                    </Field>
                    {(notes.length > 0 || decisions.length > 0) && (
                      <Field label="Contexto adjunto">
                        <div className="flex flex-wrap gap-1.5">
                          {notes.map((n) => (
                            <ContextChip
                              key={n.id}
                              active={delContext.includes(`note:${n.id}`)}
                              onClick={() => setDelContext((c) => c.includes(`note:${n.id}`) ? c.filter((x) => x !== `note:${n.id}`) : [...c, `note:${n.id}`])}
                            >
                              <NotebookPen className="h-3 w-3" /> {n.title}
                            </ContextChip>
                          ))}
                          {decisions.map((d) => (
                            <ContextChip
                              key={d.id}
                              active={delContext.includes(`decision:${d.id}`)}
                              onClick={() => setDelContext((c) => c.includes(`decision:${d.id}`) ? c.filter((x) => x !== `decision:${d.id}`) : [...c, `decision:${d.id}`])}
                            >
                              <Scale className="h-3 w-3" /> {d.title}
                            </ContextChip>
                          ))}
                        </div>
                      </Field>
                    )}
                    <Button size="sm" className="h-8 w-full gap-1.5" disabled={delBusy || !delForm.agentId || !delForm.brief.trim()} onClick={submitDelegation}>
                      {delBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                      Crear delegación
                    </Button>
                  </div>
                )}

                {delegations.length === 0 && !delegating ? (
                  <p className="px-1 py-2 text-[12px] text-muted-foreground">Sin delegaciones. Delega esta tarea a un agente.</p>
                ) : (
                  delegations.map((d) => (
                    <div key={d.id} className="rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex items-center gap-2">
                        <BadgeDot color={d.agent?.actor?.color ?? '#d97706'} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{d.agent?.name}</span>
                        <StatusBadge
                          label={DELEGATION_STATUSES.find((s) => s.value === d.status)?.label ?? d.status}
                          color={d.status === 'completed' ? '#22c55e' : d.status === 'failed' ? '#ef4444' : d.status === 'in_progress' ? '#f59e0b' : '#6b7280'}
                        />
                      </div>
                      <p className="mt-1.5 text-[12px] leading-relaxed">{d.brief}</p>
                      {d.limits && <p className="mt-1 text-[11px] text-muted-foreground">Límites: {d.limits}</p>}
                      {d.completion_criteria && <p className="mt-0.5 text-[11px] text-muted-foreground">Criterio: {d.completion_criteria}</p>}
                      {d.context.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {d.context.map((c) => (
                            <span key={c.id} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {c.kind}
                            </span>
                          ))}
                        </div>
                      )}
                      {runs.filter((r) => r.delegation_id === d.id).map((r) => (
                        <div key={r.id} className="mt-2 rounded border border-border bg-card p-2">
                          <div className="flex items-center gap-2">
                            <StatusBadge
                              label={r.status === 'succeeded' ? 'Éxito' : r.status === 'failed' ? 'Fallo' : r.status === 'running' ? 'Ejecutando' : 'Iniciado'}
                              color={r.status === 'succeeded' ? '#22c55e' : r.status === 'failed' ? '#ef4444' : '#f59e0b'}
                            />
                            <span className="ml-auto text-[10px] text-muted-foreground/70">
                              {formatDistanceToNow(new Date(r.started_at), { locale: es, addSuffix: true })}
                            </span>
                          </div>
                          {r.summary && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{r.summary}</p>}
                          {r.error && <p className="mt-1 text-[11px] leading-relaxed text-destructive">{r.error}</p>}
                          {artifacts.filter((a) => a.run_id === r.id).map((a) => (
                            <div key={a.id} className="mt-1.5 rounded bg-muted p-1.5">
                              <div className="truncate text-[11px] font-medium">{a.title}</div>
                              {a.content_text && (
                                <pre className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">{a.content_text}</pre>
                              )}
                              {a.url && (
                                <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-[10px] text-accent hover:underline">{a.url}</a>
                              )}
                            </div>
                          ))}
                        </div>
                      ))}
                      <div className="mt-2 flex items-center gap-1.5">
                        <Select value={d.status} onValueChange={(v) => updateDelegationStatus(d.id, v as typeof d.status).then(() => load())}>
                          <SelectTrigger className="h-7 w-36 text-[11px]"><SelectValue /></SelectTrigger>
                          <SelectContent>{DELEGATION_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                        </Select>
                        {d.status === 'completed' && task.status !== 'done' && (
                          <Button size="sm" className="h-7 text-[11px]" onClick={() => patch({ status: 'done' })}>
                            Cerrar tarea
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Notas</h3>
                {notes.map((n) => (
                  <div key={n.id} className="rounded border border-border bg-muted/40 p-2">
                    <div className="truncate text-[11px] font-medium">{n.title}</div>
                    <pre className="mt-0.5 whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">{n.body_md}</pre>
                  </div>
                ))}
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Añadir nota a la tarea (Enter dos veces o botón)…"
                  className="min-h-[50px] text-[12px]"
                />
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" disabled={noteBusy || !newNote.trim()} onClick={addNote}>
                    {noteBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <NotebookPen className="h-3 w-3" />}
                    Añadir nota
                  </Button>
                </div>
              </section>

              <section className="space-y-1">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Subtareas ({subtasks.length})</h3>
                {subtasks.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { onClose(); router.push(`/tasks?open=${s.id}`); }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-muted/60"
                  >
                    <BadgeDot color={s.status === 'done' ? '#22c55e' : '#6b7280'} />
                    <span className={cn('min-w-0 flex-1 truncate', s.status === 'done' && 'line-through text-muted-foreground')}>{s.title}</span>
                  </button>
                ))}
              </section>

              <section>
                <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Info</h3>
                <div className="space-y-0.5 text-[11px] text-muted-foreground">
                  <div>Creada {format(new Date(task.created_at), "d MMM yyyy", { locale: es })}</div>
                  {task.completed_at && <div>Completada {format(new Date(task.completed_at), "d MMM yyyy", { locale: es })}</div>}
                  <div className="truncate font-mono text-[10px]">id: {task.id}</div>
                </div>
              </section>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-[11px] text-destructive" disabled={busy} onClick={removeTask}>
                <Trash2 className="h-3 w-3" /> Eliminar tarea
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ContextChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors',
        active ? 'border-[hsl(var(--ring))] bg-accent-muted text-accent' : 'border-border text-muted-foreground hover:border-[hsl(var(--input))]',
      )}
    >
      {children}
    </button>
  );
}
