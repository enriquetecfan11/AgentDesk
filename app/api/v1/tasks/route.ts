import { json, parseJson, route } from '@/lib/api/http';
import { taskFiltersFromUrl } from '@/lib/api/query';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { createTask, listTasks } from '@/lib/domain/tasks';
import { taskCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/tasks — same filters as the UI (`status`, `q`, `dueBefore`…). */
export async function GET(request: Request) {
  return route(async () => {
    await requireAgent(request, 'tasks:read');
    const tasks = await listTasks(taskFiltersFromUrl(request.url));
    return json({ tasks });
  });
}

/** POST /api/v1/tasks */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'tasks:write');
    const input = await parseJson(request, taskCreateSchema);

    const task = await createTask({
      ...input,
      // A task an agent opens is, by default, work it is keeping for itself:
      // that is what makes it show up in its own queue. Reassigning it from the
      // UI is one click.
      assigneeType: input.assigneeType ?? 'agent',
      assigneeId: input.assigneeId ?? actor.agentId,
    });

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      meta: { title: task.title, status: task.status, projectId: task.projectId, via: 'api' },
    });

    return json({ task }, { status: 201 });
  });
}
