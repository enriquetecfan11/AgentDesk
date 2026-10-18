import { TasksView } from '@/components/tasks/tasks-view';
import { requireUser } from '@/lib/auth/session';
import { listLabels } from '@/lib/domain/labels';
import { listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  await requireUser();

  const [tasks, projects, labels] = await Promise.all([
    listTasks({ rootOnly: true, orderBy: 'manual' }),
    listProjects(),
    listLabels(),
  ]);

  return (
    <TasksView initialTasks={tasks} projects={projects} initialLabels={labels} />
  );
}
