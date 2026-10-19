import { BoardView } from '@/components/board/board-view';
import { requireUser } from '@/lib/auth/session';
import { listLabels } from '@/lib/domain/labels';
import { listProjects } from '@/lib/domain/projects';
import { listTasks } from '@/lib/domain/tasks';

export const dynamic = 'force-dynamic';

/**
 * Global Kanban: one swimlane per project over the status columns. Root tasks
 * only — subtasks belong to their parent card, as in the Tareas screen.
 */
export default async function BoardPage() {
  await requireUser();

  const [tasks, projects, labels] = await Promise.all([
    listTasks({ rootOnly: true, orderBy: 'manual' }),
    listProjects(),
    listLabels(),
  ]);

  return <BoardView initialTasks={tasks} projects={projects} initialLabels={labels} />;
}
