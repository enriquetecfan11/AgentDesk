import { HttpError, json, parseJson, requireUuid, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { addTaskComment, listTaskComments } from '@/lib/domain/comments';
import { getTask } from '@/lib/domain/tasks';
import { commentCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/tasks/:id/comments */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    await requireAgent(request, 'tasks:read');
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    if (!(await getTask(id))) throw new HttpError(404, 'Tarea no encontrada');

    return json({ comments: await listTaskComments(id) });
  });
}

/**
 * POST /api/v1/tasks/:id/comments
 *
 * A comment is stored as an activity entry, so it shows up both in the task
 * thread and in the unified timeline. Comments are append-only: there is no
 * edit or delete endpoint, which is also why an agent can be trusted with one.
 */
export async function POST(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'tasks:write');
    const id = requireUuid((await params).id, 'Tarea no encontrada');
    const input = await parseJson(request, commentCreateSchema);

    if (!(await getTask(id))) throw new HttpError(404, 'Tarea no encontrada');

    const comment = await addTaskComment(id, agentActivityActor(actor), input.body);
    return json({ comment }, { status: 201 });
  });
}
