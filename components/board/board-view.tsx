'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageToolbar, ToolbarFilters, ToolbarSearch } from '@/components/shell/page-toolbar';
import { ProjectBoard } from '@/components/board/project-board';
import { TaskComposer } from '@/components/tasks/task-composer';
import { TaskDetailSheet } from '@/components/tasks/task-detail-sheet';
import { useTasks } from '@/components/tasks/use-tasks';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api-client';
import type { TaskStatusValue } from '@/lib/constants';
import type { LabelDTO, ProjectDTO, TaskDTO } from '@/lib/types';

const ALL = '__all__';
const NONE = '__none__';

/** localStorage key for the last chosen assignee filter. */
const STORAGE_KEY = 'agentdesk.board.assignee';

function assigneeKey(task: TaskDTO): string {
  return task.assigneeType ? `${task.assigneeType}:${task.assigneeId}` : NONE;
}

function assigneeLabel(task: TaskDTO): string {
  return task.assigneeName ?? (task.assigneeType === 'human' ? 'Yo' : 'Agente');
}

/**
 * Screen `/board`: a global Kanban with one swimlane per project.
 *
 * It reuses the task machinery from the Tareas screen (`useTasks` for the
 * optimistic status/order/project moves, the detail sheet and the composer)
 * and only owns the filters. Live refresh comes from the shared SSE channel,
 * which is what keeps agent holds and moves visible without polling.
 */
export function BoardView({
  initialTasks,
  projects,
  initialLabels,
}: {
  initialTasks: TaskDTO[];
  projects: ProjectDTO[];
  initialLabels: LabelDTO[];
}) {
  const router = useRouter();
  const { tasks, update, create, remove } = useTasks(initialTasks);
  const [labels, setLabels] = useState(initialLabels);

  const [query, setQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ALL);

  const [composerOpen, setComposerOpen] = useState(false);
  const [selected, setSelected] = useState<TaskDTO | null>(null);

  useEffect(() => {
    setLabels(initialLabels);
  }, [initialLabels]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of tasks) {
      const key = assigneeKey(task);
      if (!seen.has(key)) seen.set(key, assigneeLabel(task));
    }
    return [...seen.entries()];
  }, [tasks]);

  // Restore the last filter once on mount, dropped if nobody matches it now.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (
        saved &&
        (saved === ALL || saved === NONE || assigneeOptions.some(([key]) => key === saved))
      ) {
        setAssigneeFilter(saved);
      }
    } catch {
      // localStorage may be unavailable; the default filter is fine.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, assigneeFilter);
    } catch {
      // Non-fatal: the filter simply is not remembered.
    }
  }, [assigneeFilter]);

  // The sheet must reflect edits made anywhere else (board, optimistic).
  useEffect(() => {
    setSelected((current) =>
      current ? (tasks.find((task) => task.id === current.id) ?? null) : null,
    );
  }, [tasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return tasks.filter((task) => {
      if (needle) {
        const haystack = `${task.title} ${task.description ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      if (assigneeFilter === NONE) {
        if (task.assigneeType) return false;
      } else if (assigneeFilter !== ALL && assigneeKey(task) !== assigneeFilter) {
        return false;
      }

      return true;
    });
  }, [tasks, query, assigneeFilter]);

  /**
   * Board move: same midpoint scheme as the Tareas board (`sortOrder` becomes
   * the midpoint between the drop neighbours), plus the lane's project so a
   * cross-lane drop re-files the task.
   */
  async function handleMove(
    id: string,
    status: TaskStatusValue,
    index: number,
    projectId: string | null,
  ) {
    const column = filtered
      .filter((task) => task.status === status && task.projectId === projectId && task.id !== id)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));

    const before = column[index - 1];
    const after = column[index];

    let sortOrder: number;
    if (!before && !after) sortOrder = 1;
    else if (!before) sortOrder = after.sortOrder - 1;
    else if (!after) sortOrder = before.sortOrder + 1;
    else sortOrder = (before.sortOrder + after.sortOrder) / 2;

    await update(id, { status, projectId, sortOrder }, { silent: true });
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
      <PageToolbar>
        <ToolbarSearch
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar tareas…"
          aria-label="Buscar tareas del tablero"
        />

        <ToolbarFilters className="flex-1">
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="h-8 w-auto max-w-full gap-1.5 text-xs" aria-label="Filtrar por responsable">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="text-xs">
                Responsable
              </SelectItem>
              <SelectItem value={NONE} className="text-xs">
                Sin responsable
              </SelectItem>
              {assigneeOptions.map(([key, label]) => (
                <SelectItem key={key} value={key} className="text-xs">
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ToolbarFilters>

        <Button
          size="sm"
          className="h-9 gap-1.5 whitespace-nowrap sm:h-8"
          onClick={() => setComposerOpen(true)}
        >
          <Plus className="size-4" />
          Nueva tarea
        </Button>
      </PageToolbar>

      <ProjectBoard
        tasks={filtered}
        projects={projects}
        onOpen={setSelected}
        onMove={(id, status, index, projectId) => void handleMove(id, status, index, projectId)}
      />

      <TaskComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        projects={projects}
        labels={labels}
        defaultStatus="todo"
        defaultProjectId={null}
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
