import { TaskWorkspace } from '@/components/tasks/task-workspace';
import { OPEN_TASK_STATUSES } from '@/lib/constants';
import { todayIso } from '@/lib/dates';
import { listLabels } from '@/lib/domain/labels';
import { listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

/**
 * Próximas: a month grid on top and the day you select below it.
 *
 * Overdue tasks live in Hoy, not here, so this view answers exactly one
 * question: what is coming.
 */
export default async function UpcomingPage() {
  const today = todayIso();

  const [tasks, projects, labels] = await Promise.all([
    listTasks({
      dueOnOrAfter: today,
      statuses: OPEN_TASK_STATUSES,
      orderBy: 'dueDate',
    }),
    listProjects(),
    listLabels(),
  ]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <TaskWorkspace
          initialTasks={tasks}
          projects={projects}
          labels={labels}
          grouping="date"
          withCalendar
          showProject
          emptyTitle="No hay nada programado"
          emptyDescription="Las tareas con fecha a partir de hoy aparecen en el calendario. Selecciona un día para verlas."
        />
      </div>
    </div>
  );
}
