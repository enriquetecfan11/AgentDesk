'use client';

import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { PriorityIcon, StatusIcon } from '@/components/tasks/task-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_META,
  TASK_STATUSES,
  TASK_STATUS_META,
} from '@/lib/constants';
import type { TaskPriorityValue, TaskStatusValue } from '@/lib/constants';
import type { LabelDTO, ProjectDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const NONE = '__none__';

export function StatusSelect({
  value,
  onChange,
  className,
}: {
  value: TaskStatusValue;
  onChange: (value: TaskStatusValue) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as TaskStatusValue)}>
      <SelectTrigger className={cn('h-8 gap-2 text-xs', className)} aria-label="Estado">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_STATUSES.map((status) => (
          <SelectItem key={status} value={status} className="text-xs">
            <span className="flex items-center gap-2">
              <StatusIcon status={status} />
              {TASK_STATUS_META[status].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PrioritySelect({
  value,
  onChange,
  className,
}: {
  value: TaskPriorityValue;
  onChange: (value: TaskPriorityValue) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as TaskPriorityValue)}>
      <SelectTrigger className={cn('h-8 gap-2 text-xs', className)} aria-label="Prioridad">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TASK_PRIORITIES.map((priority) => (
          <SelectItem key={priority} value={priority} className="text-xs">
            <span className="flex items-center gap-2">
              <PriorityIcon priority={priority} />
              {TASK_PRIORITY_META[priority].label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProjectSelect({
  value,
  onChange,
  projects,
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  projects: ProjectDTO[];
  className?: string;
}) {
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : next)}
    >
      <SelectTrigger className={cn('h-8 gap-2 text-xs', className)} aria-label="Proyecto">
        <SelectValue placeholder="Sin proyecto" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE} className="text-xs">
          Sin proyecto
        </SelectItem>
        {projects.map((project) => (
          <SelectItem key={project.id} value={project.id} className="text-xs">
            <span className="flex items-center gap-2">
              <span
                className="size-2 rounded-[3px]"
                style={{ background: project.color ?? 'hsl(var(--muted-foreground))' }}
              />
              {project.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DueDateField({
  date,
  time,
  onChange,
}: {
  date: string | null;
  time: string | null;
  onChange: (next: { dueDate: string | null; dueTime: string | null }) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="date"
        value={date ?? ''}
        onChange={(event) =>
          onChange({ dueDate: event.target.value || null, dueTime: time })
        }
        className="h-8 w-36 text-xs"
        aria-label="Fecha límite"
      />
      <Input
        type="time"
        value={time ? time.slice(0, 5) : ''}
        onChange={(event) =>
          onChange({ dueDate: date, dueTime: event.target.value || null })
        }
        className="h-8 w-24 text-xs"
        aria-label="Hora límite"
        disabled={!date}
      />
      {date && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground"
          onClick={() => onChange({ dueDate: null, dueTime: null })}
          aria-label="Quitar fecha"
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

export function LabelPicker({
  labels,
  selectedIds,
  onChange,
  onCreate,
}: {
  labels: LabelDTO[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onCreate?: (name: string) => Promise<LabelDTO | null>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const selected = new Set(selectedIds);

  function toggle(id: string) {
    onChange(selected.has(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          Etiquetas
          {selectedIds.length > 0 && (
            <span className="rounded bg-muted px-1 tabular-nums">{selectedIds.length}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        {labels.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No hay etiquetas todavía.</p>
        )}

        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {labels.map((label) => (
            <li key={label.id}>
              <button
                type="button"
                onClick={() => toggle(label.id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: label.color ?? 'hsl(var(--muted-foreground))' }}
                />
                <span className="flex-1 truncate">{label.name}</span>
                {selected.has(label.id) && <Check className="size-3.5 text-accent" />}
              </button>
            </li>
          ))}
        </ul>

        {onCreate && (
          <form
            className="mt-1 flex gap-1 border-t border-border pt-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const name = draft.trim();
              if (!name) return;
              const created = await onCreate(name);
              if (created) onChange([...selectedIds, created.id]);
              setDraft('');
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Nueva etiqueta"
              className="h-7 text-xs"
              aria-label="Nombre de la nueva etiqueta"
            />
            <Button type="submit" size="icon" variant="ghost" className="size-7" aria-label="Añadir etiqueta">
              <Plus className="size-3.5" />
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
