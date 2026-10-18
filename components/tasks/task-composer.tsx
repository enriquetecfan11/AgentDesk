'use client';

import { useState } from 'react';

import {
  DueDateField,
  FieldRow,
  LabelPicker,
  PrioritySelect,
  ProjectSelect,
  StatusSelect,
} from '@/components/tasks/task-fields';
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
import type { TaskPriorityValue, TaskStatusValue } from '@/lib/constants';
import type { LabelDTO, ProjectDTO } from '@/lib/types';
import type { TaskCreatePayload } from '@/components/tasks/use-tasks';

const EMPTY = {
  title: '',
  description: '',
  status: 'todo' as TaskStatusValue,
  priority: 'none' as TaskPriorityValue,
  projectId: null as string | null,
  dueDate: null as string | null,
  dueTime: null as string | null,
  labelIds: [] as string[],
};

export function TaskComposer({
  open,
  onOpenChange,
  projects,
  labels,
  defaultStatus = 'todo',
  defaultProjectId = null,
  onCreate,
  onCreateLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectDTO[];
  labels: LabelDTO[];
  defaultStatus?: TaskStatusValue;
  defaultProjectId?: string | null;
  onCreate: (payload: TaskCreatePayload) => Promise<unknown>;
  onCreateLabel: (name: string) => Promise<LabelDTO | null>;
}) {
  const [draft, setDraft] = useState({ ...EMPTY, status: defaultStatus, projectId: defaultProjectId });
  const [pending, setPending] = useState(false);

  function reset() {
    setDraft({ ...EMPTY, status: defaultStatus, projectId: defaultProjectId });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;

    setPending(true);
    await onCreate({
      title,
      description: draft.description.trim() || null,
      status: draft.status,
      priority: draft.priority,
      projectId: draft.projectId,
      dueDate: draft.dueDate,
      dueTime: draft.dueTime,
      labelIds: draft.labelIds,
    });
    setPending(false);
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nueva tarea</DialogTitle>
            <DialogDescription className="sr-only">
              Crea una tarea con título, proyecto, prioridad y fecha.
            </DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="¿Qué hay que hacer?"
            maxLength={500}
            required
            aria-label="Título"
          />

          <div className="space-y-2.5">
            <FieldRow label="Estado">
              <StatusSelect
                value={draft.status}
                onChange={(value) => setDraft({ ...draft, status: value })}
              />
            </FieldRow>
            <FieldRow label="Prioridad">
              <PrioritySelect
                value={draft.priority}
                onChange={(value) => setDraft({ ...draft, priority: value })}
              />
            </FieldRow>
            <FieldRow label="Proyecto">
              <ProjectSelect
                value={draft.projectId}
                projects={projects}
                onChange={(value) => setDraft({ ...draft, projectId: value })}
              />
            </FieldRow>
            <FieldRow label="Fecha">
              <DueDateField
                date={draft.dueDate}
                time={draft.dueTime}
                onChange={(next) => setDraft({ ...draft, ...next })}
              />
            </FieldRow>
            <FieldRow label="Etiquetas">
              <LabelPicker
                labels={labels}
                selectedIds={draft.labelIds}
                onChange={(ids) => setDraft({ ...draft, labelIds: ids })}
                onCreate={onCreateLabel}
              />
            </FieldRow>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || draft.title.trim().length === 0}>
              {pending ? 'Creando…' : 'Crear tarea'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
