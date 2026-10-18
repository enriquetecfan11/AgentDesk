import { CaptureBox } from '@/components/capture/capture-box';
import { TaskWorkspace } from '@/components/tasks/task-workspace';
import { listLabels } from '@/lib/domain/labels';
import { listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

/**
 * Inbox: everything captured that has no project and no date yet.
 *
 * The capture box comes first on the page, because the only job here is to
 * empty your head — triage happens later, from the task panel.
 */
export default async function InboxPage() {
  const [tasks, projects, labels] = await Promise.all([
    listTasks({ inboxOnly: true, orderBy: 'created' }),
    listProjects(),
    listLabels(),
  ]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-3 py-4">
      <CaptureBox autoFocus />

      <p className="mt-3 mb-1 px-1 text-xs text-muted-foreground">
        {tasks.length === 0
          ? 'Nada pendiente de clasificar.'
          : `${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'} sin proyecto ni fecha.`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <TaskWorkspace
          initialTasks={tasks}
          projects={projects}
          labels={labels}
          grouping="status"
          emptyTitle="El Inbox está vacío"
          emptyDescription="Todo lo que captures sin proyecto y sin fecha aterriza aquí. Añádele un proyecto o una fecha desde el panel de la tarea y saldrá de esta lista."
        />
      </div>
    </div>
  );
}
