'use client';

import { Check, Loader2, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  AutonomySelect,
  DueDateField,
  FieldRow,
  LabelPicker,
  PrioritySelect,
  ProjectSelect,
  RecurrenceField,
  StatusSelect,
} from '@/components/tasks/task-fields';
import { StatusIcon } from '@/components/tasks/task-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';
import {
  TASK_AUTONOMY_META,
  type TaskAutonomyValue,
  type TaskPriorityValue,
  type TaskStatusValue,
} from '@/lib/constants';
import { formatTimestamp } from '@/lib/dates';
import type { LabelDTO, ProjectDTO, TaskDTO } from '@/lib/types';
import type { TaskPatch } from '@/components/tasks/use-tasks';
import { cn } from '@/lib/utils';

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
  const [loadingSubtasks, setLoadingSubtasks] = useState(false);
  const [draftSubtask, setDraftSubtask] = useState('');
  const [busy, setBusy] = useState(false);

  const taskId = task?.id ?? null;

  useEffect(() => {
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
  }, [task?.id, task?.title, task?.description]);

  const loadSubtasks = useCallback(async () => {
    if (!taskId) return;
    setLoadingSubtasks(true);
    try {
      const { subtasks: rows } = await api.get<{ subtasks: TaskDTO[] }>(`/api/tasks/${taskId}`);
      setSubtasks(rows);
    } catch {
      toast.error('No se pudieron cargar las subtareas');
    } finally {
      setLoadingSubtasks(false);
    }
  }, [taskId]);

  useEffect(() => {
    void loadSubtasks();
  }, [loadSubtasks]);

  async function addSubtask(event: React.FormEvent) {
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
      void loadSubtasks();
    }
  }

  async function handleDelete() {
    if (!task) return;
    setBusy(true);
    const ok = await onDelete(task.id);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Sheet open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        {task && (
          <>
            <SheetHeader className="space-y-0 border-b border-border px-5 py-4 text-left">
              <div className="flex items-center gap-2">
                <StatusIcon status={task.status} />
                <span className="font-mono text-[11px] uppercase text-muted-foreground">
                  {task.id.slice(0, 8)}
                </span>
              </div>
              <SheetTitle className="sr-only">{task.title}</SheetTitle>
              <Textarea
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  const next = title.trim();
                  if (next && next !== task.title) onUpdate(task.id, { title: next }, { silent: true });
                  else if (!next) setTitle(task.title);
                }}
                rows={1}
                className="min-h-9 resize-none border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                aria-label="Título de la tarea"
              />
            </SheetHeader>

            <div className="space-y-3 border-b border-border px-5 py-4">
              <FieldRow label="Estado">
                <StatusSelect
                  value={task.status}
                  onChange={(value: TaskStatusValue) => onUpdate(task.id, { status: value })}
                />
              </FieldRow>

              <FieldRow label="Prioridad">
                <PrioritySelect
                  value={task.priority}
                  onChange={(value: TaskPriorityValue) => onUpdate(task.id, { priority: value })}
                />
              </FieldRow>

              <FieldRow label="Proyecto">
                <ProjectSelect
                  value={task.projectId}
                  projects={projects}
                  onChange={(value) => onUpdate(task.id, { projectId: value })}
                />
              </FieldRow>

              <FieldRow label="Fecha">
                <DueDateField
                  date={task.dueDate}
                  time={task.dueTime}
                  onChange={(next) => onUpdate(task.id, next)}
                />
              </FieldRow>

              <FieldRow label="Repetición">
                <RecurrenceField
                  value={task.recurrence}
                  onChange={(value) => onUpdate(task.id, { recurrence: value })}
                />
              </FieldRow>

              <FieldRow label="Etiquetas">
                <LabelPicker
                  labels={labels}
                  selectedIds={task.labels.map((label) => label.id)}
                  onChange={(ids) => onUpdate(task.id, { labelIds: ids })}
                  onCreate={onCreateLabel}
                />
              </FieldRow>

              <FieldRow label="Autonomía">
                <AutonomySelect
                  value={task.autonomy}
                  onChange={(value: TaskAutonomyValue) => onUpdate(task.id, { autonomy: value })}
                />
                <span className="w-full text-[11px] text-muted-foreground">
                  {TASK_AUTONOMY_META[task.autonomy].hint}
                </span>
              </FieldRow>

              <LeaseRow task={task} />
            </div>

            <div className="px-5 py-4">
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => {
                  const next = description.trim();
                  if (next !== (task.description ?? ''))
                    onUpdate(task.id, { description: next || null }, { silent: true });
                }}
                placeholder="Añade una descripción…"
                rows={4}
                className="resize-y border-0 px-0 shadow-none focus-visible:ring-0"
                aria-label="Descripción"
              />
            </div>

            <div className="border-t border-border px-5 py-4">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Subtareas
                </h3>
                {loadingSubtasks && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
                {subtasks.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {subtasks.filter((item) => item.status === 'done').length}/{subtasks.length}
                  </span>
                )}
              </div>

              <ul className="space-y-0.5">
                {subtasks.map((subtask) => (
                  <li key={subtask.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSubtask(subtask)}
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
                      onClick={() => onOpenTask(subtask)}
                      className={cn(
                        'min-w-0 flex-1 truncate py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        subtask.status === 'done' && 'text-muted-foreground line-through',
                      )}
                    >
                      {subtask.title}
                    </button>
                  </li>
                ))}
              </ul>

              <form onSubmit={addSubtask} className="mt-2 flex items-center gap-2">
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  value={draftSubtask}
                  onChange={(event) => setDraftSubtask(event.target.value)}
                  placeholder="Añadir subtarea"
                  className="h-8 border-0 px-0 text-sm shadow-none focus-visible:ring-0"
                  aria-label="Nueva subtarea"
                />
              </form>
            </div>

            <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>Creada el {formatTimestamp(task.createdAt)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={busy}
              >
                <Trash2 className="size-3.5" />
                Eliminar
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
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
    <FieldRow label="Lease">
      <span className="text-xs">
        {task.claimedByAgentName ?? 'Un agente'} la tiene tomada
        <span className="text-muted-foreground"> · {countdown}</span>
      </span>
      {task.claimCount > 1 ? (
        <span className="text-[11px] text-muted-foreground">
          tomada {task.claimCount} veces
        </span>
      ) : null}
    </FieldRow>
  );
}
