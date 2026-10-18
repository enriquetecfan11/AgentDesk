'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { TaskDetailSheet } from '@/components/tasks/task-detail-sheet';
import { groupTasks, TaskSections, type TaskGrouping } from '@/components/tasks/task-sections';
import { UpcomingCalendar } from '@/components/tasks/upcoming-calendar';
import { useTasks } from '@/components/tasks/use-tasks';
import { api } from '@/lib/api-client';
import { todayIso } from '@/lib/dates';
import type { LabelDTO, ProjectDTO, TaskDTO } from '@/lib/types';

/**
 * Shared body of Inbox, Hoy and Próximas.
 *
 * One owner for the task collection, the selection and the detail panel; the
 * pages only choose how the list is grouped, and whether the month grid is
 * shown on top.
 */
export function TaskWorkspace({
  initialTasks,
  projects,
  labels: initialLabels,
  grouping,
  withCalendar = false,
  showProject = true,
  emptyTitle,
  emptyDescription,
}: {
  initialTasks: TaskDTO[];
  projects: ProjectDTO[];
  labels: LabelDTO[];
  grouping: TaskGrouping;
  withCalendar?: boolean;
  showProject?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const router = useRouter();
  const { tasks, update, remove } = useTasks(initialTasks);

  const [labels, setLabels] = useState(initialLabels);
  const [selected, setSelected] = useState<TaskDTO | null>(null);
  const [selectedDay, setSelectedDay] = useState(todayIso);

  useEffect(() => {
    setLabels(initialLabels);
  }, [initialLabels]);

  // The panel must show the latest version of the task, wherever it was edited.
  useEffect(() => {
    setSelected((current) =>
      current ? (tasks.find((task) => task.id === current.id) ?? null) : null,
    );
  }, [tasks]);

  const sections = useMemo(
    () => groupTasks(tasks, withCalendar ? 'day' : grouping, selectedDay),
    [tasks, grouping, withCalendar, selectedDay],
  );

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
    <>
      {withCalendar && (
        <UpcomingCalendar tasks={tasks} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      )}

      <TaskSections
        sections={sections}
        onOpen={setSelected}
        onToggleDone={(task) =>
          void update(
            task.id,
            { status: task.status === 'done' ? 'todo' : 'done' },
            { silent: true },
          )
        }
        onDelete={(task) => void remove(task.id)}
        showProject={showProject}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
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
    </>
  );
}
