'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/lib/api-client';
import type { TaskPriorityValue, TaskStatusValue } from '@/lib/constants';
import type { TaskDTO } from '@/lib/types';

export type TaskPatch = {
  title?: string;
  description?: string | null;
  status?: TaskStatusValue;
  priority?: TaskPriorityValue;
  projectId?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  recurrence?: string | null;
  sortOrder?: number;
  labelIds?: string[];
};

export type TaskCreatePayload = TaskPatch & {
  title: string;
  parentTaskId?: string | null;
  status?: TaskStatusValue;
  priority?: TaskPriorityValue;
};

function bySortOrder(a: TaskDTO, b: TaskDTO) {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/**
 * Client-side task collection with optimistic updates.
 *
 * The server data is the source of truth: whenever a Server Component re-renders
 * (after `router.refresh()`), the incoming array replaces local state.
 */
export function useTasks(initialTasks: TaskDTO[]) {
  const [tasks, setTasks] = useState<TaskDTO[]>(initialTasks);
  const router = useRouter();

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const update = useCallback(
    async (id: string, patch: TaskPatch, options: { silent?: boolean } = {}) => {
      const snapshot = tasks.find((task) => task.id === id);
      const { labelIds, ...fields } = patch;

      if (snapshot) {
        setTasks((previous) =>
          previous.map((task) => (task.id === id ? { ...task, ...fields } : task)),
        );
      }

      try {
        const { task, recurrenceAdvanced } = await api.patch<{
          task: TaskDTO;
          recurrenceAdvanced: { from: string | null; to: string } | null;
        }>(`/api/tasks/${id}`, patch);

        setTasks((previous) => previous.map((item) => (item.id === id ? task : item)));

        if (recurrenceAdvanced) {
          // The task was not closed: it moved to its next occurrence.
          toast.info(`Tarea recurrente: próxima el ${recurrenceAdvanced.to}`);
        } else if (!options.silent) {
          toast.success('Tarea actualizada');
        }

        return task;
      } catch (error) {
        if (snapshot) {
          setTasks((previous) => previous.map((item) => (item.id === id ? snapshot : item)));
        }
        toast.error(error instanceof Error ? error.message : 'No se pudo guardar la tarea');
        return null;
      } finally {
        router.refresh();
      }
    },
    [tasks, router],
  );

  const create = useCallback(
    async (payload: TaskCreatePayload) => {
      try {
        const { task } = await api.post<{ task: TaskDTO }>('/api/tasks', payload);
        setTasks((previous) => [task, ...previous]);
        toast.success('Tarea creada');
        router.refresh();
        return task;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'No se pudo crear la tarea');
        return null;
      }
    },
    [router],
  );

  const remove = useCallback(
    async (id: string) => {
      const snapshot = tasks;
      setTasks((previous) => previous.filter((task) => task.id !== id));

      try {
        await api.del(`/api/tasks/${id}`);
        toast.success('Tarea eliminada');
        router.refresh();
        return true;
      } catch (error) {
        setTasks(snapshot);
        toast.error(error instanceof Error ? error.message : 'No se pudo eliminar la tarea');
        return false;
      }
    },
    [tasks, router],
  );

  /**
   * Board drag & drop. `index` is the position inside the destination column,
   * counted without the dragged card. The new position is the midpoint between
   * its neighbours, which avoids renumbering the whole column.
   */
  const move = useCallback(
    async (id: string, status: TaskStatusValue, index: number) => {
      const column = tasks
        .filter((task) => task.status === status && task.id !== id)
        .sort(bySortOrder);

      const before = column[index - 1];
      const after = column[index];

      let sortOrder: number;
      if (!before && !after) sortOrder = 1;
      else if (!before) sortOrder = after.sortOrder - 1;
      else if (!after) sortOrder = before.sortOrder + 1;
      else sortOrder = (before.sortOrder + after.sortOrder) / 2;

      return update(id, { status, sortOrder }, { silent: true });
    },
    [tasks, update],
  );

  return { tasks, update, create, remove, move };
}
