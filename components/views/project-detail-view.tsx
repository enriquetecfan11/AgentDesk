'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Bot, Loader2, NotebookPen, Plus, Scale } from 'lucide-react';
import { Topbar } from '@/components/shell/topbar';
import { CaptureBox } from '@/components/tasks/capture-box';
import { TaskList } from '@/components/tasks/task-row';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { BadgeDot, StatusBadge } from '@/components/ui/badge-dot';
import {
  createDecision, createNote, deleteNote, deleteProject, listArtifacts, listDecisions,
  listEvents, listNotes, listProjects, listTasks, updateNote, updateProject,
} from '@/lib/api';
import type { Artifact, Decision, Note, Project, TaskWithRefs, WorkspaceEvent } from '@/lib/types';

export function ProjectDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [events, setEvents] = useState<WorkspaceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('tasks');

  const [newNote, setNewNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [newDecision, setNewDecision] = useState({ title: '', what: '', why: '' });
  const [decisionBusy, setDecisionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [projects, projectTasks, projectNotes, projectDecisions, projectEvents] = await Promise.all([
        listProjects(),
        listTasks({ projectId: id as string, includeDone: true }),
        listNotes({ projectId: id as string }),
        listDecisions({ projectId: id as string }),
        listEvents({ entityType: 'project', entityId: id as string, limit: 30 }),
      ]);
      setProject(projects.find((p) => p.id === id) ?? null);
      setTasks(projectTasks);
      setNotes(projectNotes);
      setDecisions(projectDecisions);
      setEvents(projectEvents);
      const projectArtifacts = await listArtifacts({ projectId: id as string });
      setArtifacts(projectArtifacts);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const activeTasks = tasks.filter((t) => t.status !== 'done');
  const doneTasks = tasks.filter((t) => t.status === 'done');
  const pct = tasks.length ? Math.round((doneTasks.length / tasks.length) * 100) : 0;

  const addNote = async () => {
    if (!newNote.trim() || noteBusy) return;
    setNoteBusy(true);
    try {
      const firstLine = newNote.trim().split('\n')[0].slice(0, 60);
      await createNote({ title: firstLine, body_md: newNote.trim(), project_id: id as string });
      setNewNote('');
      load();
    } finally {
      setNoteBusy(false);
    }
  };

  const saveNote = async () => {
    if (editingNoteId && editBody.trim()) {
      const firstLine = editBody.trim().split('\n')[0].slice(0, 60);
      await updateNote(editingNoteId, { title: firstLine, body_md: editBody.trim() });
      setEditingNoteId(null);
      load();
    }
  };

  const addDecision = async () => {
    if (!newDecision.title.trim() || !newDecision.what.trim() || decisionBusy) return;
    setDecisionBusy(true);
    try {
      await createDecision({
        title: newDecision.title.trim(),
        what: newDecision.what.trim(),
        why: newDecision.why.trim() || null,
        project_id: id as string,
      });
      setNewDecision({ title: '', what: '', why: '' });
      load();
    } finally {
      setDecisionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="Proyecto" />
        <div className="space-y-3 p-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col">
        <Topbar title="Proyecto" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <p className="text-sm">Proyecto no encontrado.</p>
          <Button variant="outline" size="sm" onClick={() => router.push('/projects')}>Volver a proyectos</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Topbar title={project.name} subtitle={`${activeTasks.length} activas · ${pct}% completado`} />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 p-5">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
            <BadgeDot color={project.color} className="h-3 w-3" />
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold">{project.name}</h2>
              {project.description && (
                <p className="mt-0.5 text-[12px] text-muted-foreground">{project.description}</p>
              )}
            </div>
            <div className="w-32 shrink-0">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: project.color }} />
              </div>
              <div className="mt-1 text-right text-[10px] text-muted-foreground">{pct}%</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              title="Archivar proyecto"
              onClick={async () => {
                await updateProject(project.id, { status: 'archived', archived_at: new Date().toISOString() });
                router.push('/projects');
              }}
            >
              <Loader2 className="hidden" />
              <ArchiveIcon />
            </Button>
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-8">
              <TabsTrigger value="tasks" className="h-7 px-3 text-xs">Tareas ({tasks.length})</TabsTrigger>
              <TabsTrigger value="notes" className="h-7 px-3 text-xs">Notas ({notes.length})</TabsTrigger>
              <TabsTrigger value="decisions" className="h-7 px-3 text-xs">Decisiones ({decisions.length})</TabsTrigger>
              <TabsTrigger value="artifacts" className="h-7 px-3 text-xs">Artefactos ({artifacts.length})</TabsTrigger>
              <TabsTrigger value="activity" className="h-7 px-3 text-xs">Actividad</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'tasks' && (
            <div className="space-y-4">
              <CaptureBox projectId={id as string} placeholder="Añadir tarea al proyecto…" />
              <div className="rounded-lg border border-border bg-card py-1">
                <TaskList tasks={activeTasks} showProject={false} />
                {doneTasks.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Hechas</div>
                    <TaskList tasks={doneTasks} showProject={false} />
                  </>
                )}
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="space-y-3">
              <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Textarea
                  placeholder="Nueva nota (la primera línea será el título)…"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  className="min-h-[80px] text-[13px]"
                />
                <div className="flex justify-end">
                  <Button size="sm" className="h-8 gap-1.5" disabled={noteBusy || !newNote.trim()} onClick={addNote}>
                    {noteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Añadir nota
                  </Button>
                </div>
              </div>
              {notes.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">Sin notas en este proyecto</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border bg-card p-3">
                    {editingNoteId === n.id ? (
                      <>
                        <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} className="min-h-[100px] text-[13px]" />
                        <div className="mt-2 flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingNoteId(null)}>Cancelar</Button>
                          <Button size="sm" className="h-8" onClick={saveNote}>Guardar</Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <NotebookPen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <h4 className="min-w-0 flex-1 truncate text-[13px] font-medium">{n.title}</h4>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {format(new Date(n.updated_at), 'd MMM', { locale: es })}
                          </span>
                          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setEditingNoteId(n.id); setEditBody(n.body_md); }}>
                            Editar
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive" onClick={async () => { await deleteNote(n.id); load(); }}>
                            Eliminar
                          </Button>
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{n.body_md}</pre>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'decisions' && (
            <div className="space-y-3">
              <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Input placeholder="Título de la decisión" value={newDecision.title} onChange={(e) => setNewDecision((d) => ({ ...d, title: e.target.value }))} className="text-[13px]" />
                <Textarea placeholder="Qué se decidió" value={newDecision.what} onChange={(e) => setNewDecision((d) => ({ ...d, what: e.target.value }))} className="min-h-[60px] text-[13px]" />
                <Textarea placeholder="Por qué (opcional)" value={newDecision.why} onChange={(e) => setNewDecision((d) => ({ ...d, why: e.target.value }))} className="min-h-[40px] text-[13px]" />
                <div className="flex justify-end">
                  <Button size="sm" className="h-8 gap-1.5" disabled={decisionBusy || !newDecision.title.trim() || !newDecision.what.trim()} onClick={addDecision}>
                    {decisionBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />}
                    Registrar decisión
                  </Button>
                </div>
              </div>
              {decisions.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">Sin decisiones registradas</p>
              ) : (
                decisions.map((d) => (
                  <div key={d.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <Scale className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <h4 className="min-w-0 flex-1 truncate text-[13px] font-medium">{d.title}</h4>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {format(new Date(d.decided_at), "d MMM yyyy", { locale: es })}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed">{d.what}</p>
                    {d.why && <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Por qué: {d.why}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'artifacts' && (
            <div className="space-y-2">
              {artifacts.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">
                  Sin artefactos todavía. Los resultados que produzcan los agentes en este proyecto aparecerán aquí.
                </p>
              ) : (
                artifacts.map((a) => (
                  <div key={a.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge label={a.kind} color="#3b82f6" />
                      <h4 className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.title}</h4>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {format(new Date(a.created_at), 'd MMM', { locale: es })}
                      </span>
                    </div>
                    {a.content_text && (
                      <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">{a.content_text}</pre>
                    )}
                    {a.url && (
                      <a href={a.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12px] text-accent hover:underline">
                        {a.url}
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'activity' && (
            <div className="rounded-lg border border-border bg-card">
              {events.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted-foreground">Sin actividad registrada</p>
              ) : (
                <div className="divide-y">
                  {events.map((e) => (
                    <div key={e.id} className="flex items-center gap-2.5 px-3 py-2 text-[12px]">
                      <Bot className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-foreground">{e.actor?.display_name ?? e.actor?.name ?? 'Sistema'}</span>
                        {' '}· {e.kind.replace(/[_.]/g, ' ')}
                        {e.entity_title && <> · {e.entity_title}</>}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground/70">
                        {formatDistanceToNow(new Date(e.created_at), { locale: es, addSuffix: true })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ArchiveIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" strokeLinecap="round" />
    </svg>
  );
}
