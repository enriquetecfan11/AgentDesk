import { TaskWorkspace } from '@/components/tasks/task-workspace';
import { CaptureBox } from '@/components/capture/capture-box';
import { OPEN_TASK_STATUSES } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { listLabels } from '@/lib/domain/labels';
import { listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

/**
 * Hoy: what is due today, plus anything that slipped past its date.
 *
 * Overdue work is shown here rather than hidden, because a task that keeps
 * being postponed is exactly the one that needs to be seen.
 */
export default async function TodayPage() {
  const today = todayIso();

  const [tasks, projects, labels] = await Promise.all([
    listTasks({
      dueOnOrBefore: today,
      statuses: OPEN_TASK_STATUSES,
      orderBy: 'dueDate',
    }),
    listProjects(),
    listLabels(),
  ]);

  const overdue = tasks.filter((task) => task.dueDate !== null && task.dueDate < today).length;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 py-4">
      <CaptureBox placeholder="Captura algo para hoy… «revisar backups a las 18:00 p2»" />

      <p className="mt-3 mb-1 px-1 text-xs text-muted-foreground">
        {tasks.length === 0
          ? 'Nada para hoy.'
          : `${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'} para hoy${
              overdue > 0 ? `, ${overdue} vencida${overdue === 1 ? '' : 's'}` : ''
            }.`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TaskWorkspace
          initialTasks={tasks}
          projects={projects}
          labels={labels}
          grouping="today"
          emptyTitle="Nada para hoy"
          emptyDescription="Las tareas con fecha de hoy o anterior aparecen aquí, junto con las que se han quedado atrás."
        />
      </div>
    </div>
  );
}
