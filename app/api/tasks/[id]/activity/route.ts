import { HttpError, json, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { listActivityForEntity } from '@/lib/domain/activity';
import { getTask } from '@/lib/domain/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/tasks/:id/activity — the task's own timeline.
 *
 * The panel shows this next to the subtasks, so a change made from the board,
 * the command palette or an agent reads the same as one made from here.
 */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    if (!(await getTask(id))) throw new HttpError(404, 'Tarea no encontrada');

    return json({ activity: await listActivityForEntity('task', id, 25) });
  });
}
