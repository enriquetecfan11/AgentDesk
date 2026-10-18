'use client';

import { LayoutList, Plus, Search, SlidersHorizontal, SquareKanban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { TaskBoard } from '@/components/tasks/task-board';
import { TaskComposer } from '@/components/tasks/task-composer';
import { TaskDetailSheet } from '@/components/tasks/task-detail-sheet';
import { TaskListView } from '@/components/tasks/task-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTasks, type TaskPatch } from '@/components/tasks/use-tasks';
import { api } from '@/lib/api-client';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_META,
  TASK_STATUSES,
  TASK_STATUS_META,
} from '@/lib/constants';
import type { TaskDTO, LabelDTO, ProjectDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const ALL = '__all__';
const NONE = '__none__';
const OPEN = '__open__';

const SORTS = [
  { value: 'manual', label: 'Manual' },
  { value: 'dueDate', label: 'Fecha' },
  { value: 'priority', label: 'Prioridad' },
  { value: 'created', label: 'Recientes' },
] as const;

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
  none: 4,
};

export function TasksView({
  initialTasks,
  projects,
  initialLabels,
  defaultStatus = 'todo',
  defaultProjectId = null,
  showProject = true,
}: {
  initialTasks: TaskDTO[];
  projects: ProjectDTO[];
  initialLabels: LabelDTO[];
  defaultStatus?: TaskDTO['status'];
  defaultProjectId?: string | null;
  showProject?: boolean;
}) {
  const router = useRouter();
  const { tasks, update, create, remove, move } = useTasks(initialTasks);
  const [labels, setLabels] = useState(initialLabels);

  const [view, setView] = useState<'list' | 'board'>('list');
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>(defaultProjectId ?? ALL);
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(OPEN);
  const [sort, setSort] = useState<(typeof SORTS)[number]['value']>('manual');

  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState<TaskDTO | null>(null);

  useEffect(() => {
    setLabels(initialLabels);
  }, [initialLabels]);

  // The sheet must reflect edits made anywhere else (board, list, optimistic).
  useEffect(() => {
    setSelected((current) =>
      current ? (tasks.find((task) => task.id === current.id) ?? null) : null,
    );
  }, [tasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const result = tasks.filter((task) => {
      if (needle) {
        const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      if (projectFilter === NONE) {
        if (task.projectId !== null) return false;
      } else if (projectFilter !== ALL && task.projectId !== projectFilter) {
        return false;
      }

      if (priorityFilter !== ALL && task.priority !== priorityFilter) return false;

      if (statusFilter === OPEN) {
        if (task.status === 'done' || task.status === 'cancelled') return false;
      } else if (statusFilter !== ALL && task.status !== statusFilter) {
        return false;
      }

      return true;
    });

    return result.sort((a, b) => {
      switch (sort) {
        case 'dueDate':
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        case 'priority':
          return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        case 'created':
          return b.createdAt.localeCompare(a.createdAt);
        default:
          return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
      }
    });
  }, [tasks, query, projectFilter, priorityFilter, statusFilter, sort]);

  async function handleToggleDone(task: TaskDTO) {
    const next = task.status === 'done' ? 'todo' : 'done';
    await update(task.id, { status: next }, { silent: true });
  }

  async function handleCreateLabel(name: string): Promise<LabelDTO | null> {
    try {
      const { label } = await api.post<{ label: LabelDTO }>('/api/labels', { name });
      setLabels((previous) =>
        previous.some((item) => item.id === label.id) ? previous : [...previous, label],
      );
      router.refresh();
      return label;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la etiqueta');
      return null;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="relative min-w-45 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar tareas…"
            className="h-8 pl-8 text-sm"
            aria-label="Buscar tareas"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="Filtrar por estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OPEN} className="text-xs">
              Abiertas
            </SelectItem>
            <SelectItem value={ALL} className="text-xs">
              Todas
            </SelectItem>
            {TASK_STATUSES.map((status) => (
              <SelectItem key={status} value={status} className="text-xs">
                {TASK_STATUS_META[status].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="Filtrar por prioridad">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className="text-xs">
              Prioridad
            </SelectItem>
            {TASK_PRIORITIES.filter((priority) => priority !== 'none').map((priority) => (
              <SelectItem key={priority} value={priority} className="text-xs">
                {TASK_PRIORITY_META[priority].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="Filtrar por proyecto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL} className="text-xs">
              Proyecto
            </SelectItem>
            <SelectItem value={NONE} className="text-xs">
              Sin proyecto
            </SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id} className="text-xs">
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(value) => setSort(value as (typeof SORTS)[number]['value'])}
        >
          <SelectTrigger className="h-8 w-auto gap-1.5 text-xs" aria-label="Ordenar por">
            <SlidersHorizontal className="size-3.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div
          className="flex items-center rounded-md border border-input p-0.5"
          role="group"
          aria-label="Vista"
        >
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={cn(
              'grid size-7 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
            title="Lista"
          >
            <LayoutList className="size-4" />
            <span className="sr-only">Vista de lista</span>
          </button>
          <button
            type="button"
            onClick={() => setView('board')}
            aria-pressed={view === 'board'}
            className={cn(
              'grid size-7 place-items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              view === 'board' ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
            title="Tablero"
          >
            <SquareKanban className="size-4" />
            <span className="sr-only">Vista de tablero</span>
          </button>
        </div>

        <Button size="sm" className="h-8 gap-1.5" onClick={() => setComposerOpen(true)}>
          <Plus className="size-4" />
          Nueva tarea
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="grid place-items-center px-6 py-24 text-center">
            <p className="text-sm font-medium">No hay tareas que coincidan</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Ajusta los filtros o crea una tarea nueva.
            </p>
          </div>
        ) : view === 'list' ? (
          <TaskListView
            tasks={filtered}
            onOpen={setSelected}
            onToggleDone={handleToggleDone}
            onDelete={(task) => void remove(task.id)}
            showProject={showProject}
          />
        ) : (
          <TaskBoard
            tasks={filtered}
            onOpen={setSelected}
            onMove={(id, status, index) => void move(id, status, index)}
            showProject={showProject}
          />
        )}
      </div>

      <TaskComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        projects={projects}
        labels={labels}
        defaultStatus={defaultStatus}
        defaultProjectId={defaultProjectId}
        onCreate={create}
        onCreateLabel={handleCreateLabel}
      />

      <TaskDetailSheet
        task={selected}
        projects={projects}
        labels={labels}
        onClose={() => setSelected(null)}
        onUpdate={update}
        onDelete={remove}
        onCreateLabel={handleCreateLabel}
        onOpenTask={setSelected}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

export type { TaskPatch };
