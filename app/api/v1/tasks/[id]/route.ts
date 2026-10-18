import { HttpError, json, readJson, requireUuid, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { listTaskComments } from '@/lib/domain/comments';
import { deleteTask, getSubtasks, getTask, setTaskLabels, updateTask } from '@/lib/domain/tasks';
import { taskLabelsSchema, taskUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/tasks/:id — task, subtasks and the comment thread. */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    await requireAgent(request, 'tasks:read');
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    const task = await getTask(id);
    if (!task) throw new HttpError(404, 'Tarea no encontrada');

    const [subtasks, comments] = await Promise.all([getSubtasks(id), listTaskComments(id)]);

    return json({ task, subtasks, comments });
  });
}

/** PATCH /api/v1/tasks/:id */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'tasks:write');
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    const before = await getTask(id);
    if (!before) throw new HttpError(404, 'Tarea no encontrada');

    const raw = await readJson(request);

    const parsed = taskUpdateSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(422, 'Datos inválidos', parsed.error.issues);
    const input = parsed.data;

    const result = await updateTask(id, input);
    if (!result) throw new HttpError(404, 'Tarea no encontrada');
    const { task, recurrenceAdvanced } = result;

    const labelsParsed = taskLabelsSchema.safeParse(raw);
    if (labelsParsed.success) await setTaskLabels(id, labelsParsed.data.labelIds);

    const statusChanged = input.status !== undefined && input.status !== before.status;

    await logActivity({
      actor: agentActivityActor(actor),
      action: recurrenceAdvanced
        ? 'task.recurred'
        : statusChanged
          ? 'task.status_changed'
          : 'task.updated',
      entityType: 'task',
      entityId: task.id,
      meta: statusChanged
        ? { from: before.status, to: task.status, title: task.title, via: 'api' }
        : { fields: Object.keys(input), title: task.title, via: 'api' },
    });

    return json({ task: await getTask(task.id), recurrenceAdvanced });
  });
}

/** DELETE /api/v1/tasks/:id */
export async function DELETE(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'tasks:write');
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    const deleted = await deleteTask(id);
    if (!deleted) throw new HttpError(404, 'Tarea no encontrada');

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'task.deleted',
      entityType: 'task',
      entityId: id,
      meta: { via: 'api' },
    });

    return json({ ok: true });
  });
}
