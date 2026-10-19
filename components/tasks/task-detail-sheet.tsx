'use client';

import {
  Bot,
  Check,
  CircleDot,
  Copy,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Repeat,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  AutonomySelect,
  DueDateField,
  LabelPicker,
  PrioritySelect,
  ProjectSelect,
  RecurrenceField,
  StatusSelect,
} from '@/components/tasks/task-fields';
import { StatusIcon } from '@/components/tasks/task-icons';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import { copyText } from '@/lib/clipboard';
import {
  TASK_AUTONOMY_META,
  TASK_STATUS_META,
  type TaskAutonomyValue,
  type TaskPriorityValue,
  type TaskStatusValue,
} from '@/lib/constants';
import { formatRelative, formatTimestamp } from '@/lib/dates';
import type { ActivityDTO, LabelDTO, ProjectDTO, TaskDTO } from '@/lib/types';
import type { TaskPatch } from '@/components/tasks/use-tasks';
import { cn } from '@/lib/utils';

/**
 * The task panel, shared by every screen that can open a task.
 *
 * A centred modal: full screen on a phone and a `max-w` card from `sm`
 * upwards, with a fixed header and a body that scrolls on its own. The panel
 * edits in place: fields save on change, the title and description save on
 * blur, and closing first flushes any pending draft so Escape or a click on
 * the overlay never loses a keystroke.
 */
export function TaskDetailSheet({
  task,
  projects,
  labels,
  onClose,
  onUpdate,
  onDelete,
  onCreateLabel,
  onOpenTask,
  onChanged,
}: {
  task: TaskDTO | null;
  projects: ProjectDTO[];
  labels: LabelDTO[];
  onClose: () => void;
  onUpdate: (id: string, patch: TaskPatch, options?: { silent?: boolean }) => Promise<TaskDTO | null>;
  onDelete: (id: string) => Promise<boolean>;
  onCreateLabel: (name: string) => Promise<LabelDTO | null>;
  onOpenTask: (task: TaskDTO) => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subtasks, setSubtasks] = useState<TaskDTO[]>([]);
  const [activity, setActivity] = useState<ActivityDTO[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [draftSubtask, setDraftSubtask] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const taskId = task?.id ?? null;
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeId = useRef<string | null>(null);
  const closing = useRef(false);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Mirrors `taskId` so an in-flight load cannot land on the next task. */
  const taskIdRef = useRef<string | null>(null);
  /**
   * Latest task from the parent. `saveDrafts` awaits an in-flight request and
   * then recomputes the draft; reading the render closure there would compare
   * against the pre-save title and send the same patch twice.
   */
  const taskRef = useRef<TaskDTO | null>(task);

  // Reset the draft only when a different task opens. Server refreshes after a
  // save must not clobber what is being typed.
  useEffect(() => {
    taskRef.current = task;
    if (!task) {
      activeId.current = null;
      return;
    }
    if (activeId.current === task.id) return;

    activeId.current = task.id;
    setTitle(task.title);
    setDescription(task.description ?? '');
  }, [task]);

  useEffect(() => {
    taskIdRef.current = taskId;
    setSubtasks([]);
    setActivity([]);
    setDraftSubtask('');
    setSaved(false);
  }, [taskId]);

  // Auto-grow both writing surfaces to fit what is written.
  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [title, taskId]);

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [description, taskId]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const loadActivity = useCallback(async () => {
    if (!taskId) return;
    const requestedFor = taskId;
    try {
      const { activity: rows } = await api.get<{ activity: ActivityDTO[] }>(
        `/api/tasks/${taskId}/activity`,
      );
      if (taskIdRef.current === requestedFor) setActivity(rows);
    } catch {
      // Activity is secondary: failing to refresh it must not break editing.
    }
  }, [taskId]);

  const loadDetails = useCallback(async () => {
    if (!taskId) return;
    const requestedFor = taskId;
    setLoadingDetails(true);
    try {
      const data = await api.get<{ subtasks: TaskDTO[]; activity: ActivityDTO[] }>(
        `/api/tasks/${taskId}`,
      );
      if (taskIdRef.current !== requestedFor) return;
      setSubtasks(data.subtasks);
      setActivity(data.activity ?? []);
    } catch {
      if (taskIdRef.current === requestedFor) {
        toast.error('No se pudieron cargar los detalles de la tarea');
      }
    } finally {
      if (taskIdRef.current === requestedFor) setLoadingDetails(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  function draftPatch(): TaskPatch | null {
    const current = taskRef.current;
    if (!current) return null;

    const next: TaskPatch = {};
    const nextTitle = title.trim();
    const nextDescription = description.trim();

    if (nextTitle.length > 0 && nextTitle !== current.title) next.title = nextTitle;
    if (nextDescription !== (current.description ?? '').trim()) {
      next.description = nextDescription || null;
    }

    return Object.keys(next).length > 0 ? next : null;
  }

  function hasDraft(): boolean {
    const current = taskRef.current;
    if (!current) return false;
    const nextTitle = title.trim();
    return (
      (nextTitle.length > 0 && nextTitle !== current.title) ||
      description.trim() !== (current.description ?? '').trim()
    );
  }

  async function patchTask(patch: TaskPatch): Promise<boolean> {
    const current = taskRef.current;
    if (!current) return false;

    setSaving(true);
    setSaved(false);
    const updated = await onUpdate(current.id, patch, { silent: true });
    setSaving(false);

    if (!updated) return false;

    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1800);
    void loadActivity();
    return true;
  }

  /**
   * Flush the title/description draft, joining an in-flight save instead of
   * sending the same patch twice (blur followed by an overlay click).
   */
  async function saveDrafts(): Promise<boolean> {
    if (saveInFlight.current) await saveInFlight.current;

    const current = taskRef.current;
    if (!current) return true;

    const patch = draftPatch();
    if (!patch) {
      if (!title.trim()) setTitle(current.title);
      return true;
    }

    const promise = patchTask(patch);
    saveInFlight.current = promise;
    try {
      return await promise;
    } finally {
      if (saveInFlight.current === promise) saveInFlight.current = null;
    }
  }

  async function requestClose() {
    if (closing.current) return;
    closing.current = true;
    try {
      if (hasDraft()) {
        const ok = await saveDrafts();
        if (!ok) return;
      }
      onClose();
    } finally {
      closing.current = false;
    }
  }

  async function openTask(next: TaskDTO) {
    if (hasDraft()) {
      const ok = await saveDrafts();
      if (!ok) return;
    }
    onOpenTask(next);
  }

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    const value = draftSubtask.trim();
    if (!value || !task) return;

    setDraftSubtask('');
    try {
      const { task: created } = await api.post<{ task: TaskDTO }>('/api/tasks', {
        title: value,
        parentTaskId: task.id,
        projectId: task.projectId,
      });
      setSubtasks((previous) => [...previous, created]);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la subtarea');
    }
  }

  async function toggleSubtask(subtask: TaskDTO) {
    const next = subtask.status === 'done' ? 'todo' : 'done';
    setSubtasks((previous) =>
      previous.map((item) => (item.id === subtask.id ? { ...item, status: next } : item)),
    );
    try {
      const { task: updated } = await api.patch<{ task: TaskDTO }>(`/api/tasks/${subtask.id}`, {
        status: next,
      });
      setSubtasks((previous) =>
        previous.map((item) => (item.id === subtask.id ? updated : item)),
      );
      onChanged();
    } catch {
      toast.error('No se pudo actualizar la subtarea');
      void loadDetails();
    }
  }

  async function handleDelete() {
    if (!task) return;
    setBusy(true);
    const ok = await onDelete(task.id);
    setBusy(false);
    setConfirmDelete(false);
    if (ok) onClose();
  }

  async function copyId() {
    if (!task) return;
    const ok = await copyText(task.id);
    toast[ok ? 'success' : 'error'](ok ? 'Identificador copiado' : 'No se pudo copiar');
  }

  const doneSubtasks = subtasks.filter((item) => item.status === 'done').length;
  const subtaskPct = subtasks.length > 0 ? Math.round((doneSubtasks / subtasks.length) * 100) : 0;
  const statusMeta = task ? TASK_STATUS_META[task.status] : null;

  return (
    <>
      <Dialog
        open={task !== null}
        onOpenChange={(open) => {
          if (!open) void requestClose();
        }}
      >
        <DialogContent
          overlayClassName="bg-black/60"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // Focus the modal itself, not the first control: on a phone this
            // avoids opening the keyboard before the user taps a field.
            event.preventDefault();
            panelRef.current?.focus();
          }}
          className={cn(
            // Centred card from `sm` up; full screen on a phone. No position
            // utility here, or `cn` would override the `fixed` + centring
            // transform the primitive already applies.
            'block max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[720px] gap-0 rounded-lg p-0',
            'max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:border-0',
            '[&>button]:hidden',
          )}
        >
          {task && (
            <>
              <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur md:px-5">
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <StatusIcon status={task.status} />
                    <span className={cn('truncate', statusMeta?.text)}>
                      {statusMeta?.label}
                    </span>
                    <span aria-hidden className="shrink-0">
                      ·
                    </span>
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
                      {task.id.slice(0, 8)}
                    </span>
                    {task.project && (
                      <span className="hidden min-w-0 items-center gap-1.5 sm:flex">
                        <span aria-hidden className="shrink-0">
                          ·
                        </span>
                        <span
                          className="size-1.5 shrink-0 rounded-[2px]"
                          style={{
                            background:
                              task.project.color ?? 'hsl(var(--muted-foreground))',
                          }}
                        />
                        <span className="truncate">{task.project.name}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <span
                      className="flex items-center gap-1 text-[11px] text-muted-foreground"
                      aria-live="polite"
                    >
                      {saving ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : saved ? (
                        <Check className="size-3" />
                      ) : null}
                      <span className="sr-only sm:not-sr-only">
                        {saving ? 'Guardando…' : saved ? 'Guardado' : ''}
                      </span>
                    </span>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground"
                          aria-label="Más acciones de la tarea"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => void copyId()} className="gap-2">
                          <Copy className="size-3.5" />
                          Copiar identificador
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="gap-2 text-destructive focus:text-destructive"
                          onClick={() => setConfirmDelete(true)}
                        >
                          <Trash2 className="size-3.5" />
                          Eliminar tarea
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      onClick={() => void requestClose()}
                      aria-label="Cerrar"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </header>

                <div ref={panelRef} tabIndex={-1} className="focus:outline-none">
                  <div className="px-4 pb-3 pt-4 md:px-5">
                    <DialogTitle className="sr-only">{title.trim() || task.title}</DialogTitle>
                  <Textarea
                    ref={titleRef}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => void saveDrafts()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    rows={1}
                    placeholder="Título de la tarea"
                    aria-label="Título de la tarea"
                    className="-mx-1 min-h-9 w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded-md border-0 px-1 py-0.5 text-xl font-semibold leading-snug tracking-tight shadow-none hover:bg-muted/20 focus-visible:bg-muted/40 focus-visible:ring-0 md:text-2xl"
                  />
                </div>

                <section className="border-y border-border bg-muted/20 px-4 py-3 md:px-5">
                  <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Propiedades
                  </h2>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    <Property label="Estado">
                      <StatusSelect
                        value={task.status}
                        onChange={(value: TaskStatusValue) => void patchTask({ status: value })}
                      />
                    </Property>

                    <Property label="Prioridad">
                      <PrioritySelect
                        value={task.priority}
                        onChange={(value: TaskPriorityValue) =>
                          void patchTask({ priority: value })
                        }
                      />
                    </Property>

                    <Property label="Proyecto" className="col-span-2">
                      <ProjectSelect
                        value={task.projectId}
                        projects={projects}
                        onChange={(value) => void patchTask({ projectId: value })}
                      />
                    </Property>

                    <Property label="Fecha" className="col-span-2">
                      <DueDateField
                        date={task.dueDate}
                        time={task.dueTime}
                        onChange={(next) => void patchTask(next)}
                      />
                    </Property>

                    <Property label="Repetición" className="col-span-2">
                      <RecurrenceField
                        value={task.recurrence}
                        onChange={(value) => void patchTask({ recurrence: value })}
                      />
                    </Property>

                    <Property label="Etiquetas" className="col-span-2">
                      <LabelPicker
                        labels={labels}
                        selectedIds={task.labels.map((label) => label.id)}
                        onChange={(ids) => void patchTask({ labelIds: ids })}
                        onCreate={onCreateLabel}
                        className="w-full justify-start"
                      />
                    </Property>

                    <Property label="Autonomía" className="col-span-2">
                      <AutonomySelect
                        value={task.autonomy}
                        onChange={(value: TaskAutonomyValue) =>
                          void patchTask({ autonomy: value })
                        }
                      />
                      <span className="w-full text-[11px] leading-snug text-muted-foreground">
                        {TASK_AUTONOMY_META[task.autonomy].hint}
                      </span>
                    </Property>

                    <LeaseRow task={task} />
                  </div>
                </section>

                <section className="px-4 py-4 md:px-5">
                  <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Descripción
                  </h2>
                  <Textarea
                    ref={descriptionRef}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={() => void saveDrafts()}
                    placeholder="Añade una descripción…"
                    rows={2}
                    aria-label="Descripción"
                    className="mt-1.5 -mx-1 min-h-[2.5rem] w-[calc(100%+0.5rem)] resize-none overflow-hidden rounded-md border-0 px-1 py-0.5 text-sm leading-relaxed shadow-none hover:bg-muted/20 focus-visible:bg-muted/30 focus-visible:ring-0"
                  />
                </section>

                <section className="border-t border-border px-4 py-4 md:px-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Subtareas
                    </h2>
                    {loadingDetails && (
                      <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    )}
                    {subtasks.length > 0 && (
                      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                        {doneSubtasks}/{subtasks.length}
                      </span>
                    )}
                  </div>

                  {subtasks.length > 0 && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-[width]"
                        style={{ width: `${subtaskPct}%` }}
                      />
                    </div>
                  )}

                  <ul className="mt-1.5 space-y-0.5">
                    {subtasks.map((subtask) => (
                      <li
                        key={subtask.id}
                        className="-mx-1 flex items-start gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-muted/50"
                      >
                        <button
                          type="button"
                          onClick={() => void toggleSubtask(subtask)}
                          className="grid size-7 shrink-0 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={
                            subtask.status === 'done'
                              ? `Marcar "${subtask.title}" como pendiente`
                              : `Completar "${subtask.title}"`
                          }
                        >
                          {subtask.status === 'done' ? (
                            <span className="grid size-4 place-items-center rounded-full bg-emerald-500 text-white">
                              <Check className="size-3" strokeWidth={3} />
                            </span>
                          ) : (
                            <span className="size-4 rounded-full border border-muted-foreground/50" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void openTask(subtask)}
                          className={cn(
                            'min-w-0 flex-1 break-words py-1 text-left text-sm leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            subtask.status === 'done' &&
                              'text-muted-foreground line-through',
                          )}
                        >
                          {subtask.title}
                        </button>
                      </li>
                    ))}
                  </ul>

                  <form onSubmit={addSubtask} className="mt-1.5 flex items-center gap-2">
                    <Plus className="size-4 shrink-0 text-muted-foreground" />
                    <Input
                      value={draftSubtask}
                      onChange={(event) => setDraftSubtask(event.target.value)}
                      placeholder="Añadir subtarea"
                      className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
                      aria-label="Nueva subtarea"
                    />
                  </form>
                </section>

                <section className="border-t border-border px-4 py-4 md:px-5">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Actividad
                    </h2>
                    {loadingDetails && (
                      <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {activity.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Sin cambios registrados todavía.
                    </p>
                  ) : (
                    <ol className="mt-3 space-y-3">
                      {activity.map((entry) => (
                        <li key={entry.id} className="flex gap-2.5">
                          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground">
                            <ActivityEntryIcon action={entry.action} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-xs leading-relaxed">
                              <span className="font-medium text-foreground">
                                {entry.actorName}
                              </span>{' '}
                              <span className="text-muted-foreground">
                                {describeActivity(entry)}
                              </span>
                            </p>
                            <time
                              dateTime={entry.createdAt}
                              title={formatTimestamp(entry.createdAt)}
                              className="mt-0.5 block text-[11px] text-muted-foreground"
                            >
                              {formatRelative(entry.createdAt)}
                            </time>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}

                  <p className="mt-4 text-[11px] text-muted-foreground">
                    Creada el {formatTimestamp(task.createdAt)}
                  </p>
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {task && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar «{task.title}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Se eliminarán también sus subtareas. Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void handleDelete();
                }}
                disabled={busy}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                Eliminar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

/** A labelled cell in the compact properties grid. */
function Property({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <span className="block text-[11px] leading-none text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * Who is holding the task right now.
 *
 * Only rendered when somebody is: an empty "nobody has this" row on every
 * task would be noise on the ninety per cent of tasks no agent ever touches.
 * The countdown is what makes a stuck runner visible — a lease that never
 * moves is an agent that stopped calling.
 */
function LeaseRow({ task }: { task: TaskDTO }) {
  if (!task.claimedByAgentId || task.leaseSecondsLeft === null) return null;

  const left = task.leaseSecondsLeft;
  const countdown =
    left <= 0
      ? 'el lease ha caducado: volverá a la cola'
      : left < 60
        ? `caduca en ${left} s`
        : `caduca en ${Math.floor(left / 60)} min`;

  return (
    <Property label="Lease" className="col-span-2">
      <span className="text-xs">
        {task.claimedByAgentName ?? 'Un agente'} la tiene tomada
        <span className="text-muted-foreground"> · {countdown}</span>
      </span>
      {task.claimCount > 1 ? (
        <span className="text-[11px] text-muted-foreground">
          tomada {task.claimCount} veces
        </span>
      ) : null}
    </Property>
  );
}

function ActivityEntryIcon({ action }: { action: string }) {
  const Icon =
    action === 'task.created'
      ? Plus
      : action === 'task.comment'
        ? MessageSquare
        : action === 'task.completed'
          ? Check
          : action === 'task.failed'
            ? TriangleAlert
            : action === 'task.claimed' || action === 'task.lease_expired'
              ? Bot
              : action === 'task.recurred'
                ? Repeat
                : action === 'task.autonomy_changed'
                  ? ShieldCheck
                  : action === 'task.updated' || action === 'task.status_changed'
                    ? Pencil
                    : CircleDot;

  return <Icon className="size-3" aria-hidden />;
}

const FIELD_LABELS: Record<string, string> = {
  title: 'el título',
  description: 'la descripción',
  status: 'el estado',
  priority: 'la prioridad',
  projectId: 'el proyecto',
  dueDate: 'la fecha',
  dueTime: 'la hora',
  recurrence: 'la repetición',
  labelIds: 'las etiquetas',
  sortOrder: 'el orden',
  autonomy: 'la autonomía',
};

function statusLabel(value: unknown): string {
  return typeof value === 'string' && value in TASK_STATUS_META
    ? TASK_STATUS_META[value as TaskStatusValue].label
    : '—';
}

function autonomyLabel(value: unknown): string {
  return typeof value === 'string' && value in TASK_AUTONOMY_META
    ? TASK_AUTONOMY_META[value as TaskAutonomyValue].label
    : '—';
}

function truncate(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Turns the stored action + meta into the sentence shown in the timeline. */
function describeActivity(entry: ActivityDTO): string {
  const meta = entry.meta ?? {};

  switch (entry.action) {
    case 'task.created':
      return 'creó la tarea';
    case 'task.updated': {
      const fields = Array.isArray(meta.fields)
        ? meta.fields.filter((value): value is string => typeof value === 'string')
        : [];
      return fields.length > 0
        ? `actualizó ${fields.map((field) => FIELD_LABELS[field] ?? field).join(', ')}`
        : 'actualizó la tarea';
    }
    case 'task.status_changed':
      return `cambió el estado de «${statusLabel(meta.from)}» a «${statusLabel(meta.to)}»`;
    case 'task.autonomy_changed':
      return `cambió la autonomía de «${autonomyLabel(meta.from)}» a «${autonomyLabel(meta.to)}»`;
    case 'task.recurred':
      return typeof meta.to === 'string'
        ? `reprogramó la repetición para el ${meta.to}`
        : 'reprogramó la repetición';
    case 'task.claimed':
      return 'tomó la tarea';
    case 'task.completed':
      return 'cerró la tarea';
    case 'task.failed':
      return typeof meta.error === 'string'
        ? `no pudo terminarla: «${truncate(meta.error, 120)}»`
        : 'no pudo terminar la tarea';
    case 'task.lease_expired':
      return 'soltó la tarea por caducidad del lease';
    case 'task.comment':
      return typeof meta.body === 'string'
        ? `comentó: «${truncate(meta.body, 140)}»`
        : 'comentó la tarea';
    default:
      return entry.action.startsWith('task.') ? 'actualizó la tarea' : entry.action;
  }
}
