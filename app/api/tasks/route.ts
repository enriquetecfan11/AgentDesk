import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { taskFiltersFromUrl } from '@/lib/api/query';
import { logActivity } from '@/lib/domain/activity';
import { createTask, listTasks } from '@/lib/domain/tasks';
import { taskCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/tasks?projectId=…&status=todo,in_progress&q=…&order=dueDate */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();
    const tasks = await listTasks(taskFiltersFromUrl(request.url));
    return json({ tasks });
  });
}

/** POST /api/tasks */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, taskCreateSchema);

    const task = await createTask(input);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      meta: { title: task.title, status: task.status, projectId: task.projectId },
    });

    return json({ task }, { status: 201 });
  });
}
