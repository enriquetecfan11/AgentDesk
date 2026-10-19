import { HttpError, json, readJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { listActivityForEntity, logActivity } from '@/lib/domain/activity';
import { deleteTask, getSubtasks, getTask, setTaskLabels, updateTask } from '@/lib/domain/tasks';
import { taskLabelsSchema, taskUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/tasks/:id — subtasks and timeline for the detail panel. */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    const task = await getTask(id);
    if (!task) throw new HttpError(404, 'Tarea no encontrada');

    const [subtasks, activity] = await Promise.all([
      getSubtasks(id),
      listActivityForEntity('task', id, 25),
    ]);

    return json({ task, subtasks, activity });
  });
}

/**
 * PATCH /api/tasks/:id
 *
 * Handles both field edits and board moves (the board sends `status` plus
 * `sortOrder`). `labelIds` is applied transactionally through a separate path.
 */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    const before = await getTask(id);
    if (!before) throw new HttpError(404, 'Tarea no encontrada');

    // Read the body once: `taskUpdateSchema` strips unknown keys, so the same
    // payload can be validated again against the labels schema.
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
    // Worth its own entry: it is the setting that decides what an agent may do
    // on this task without asking, so "who widened this, and when" has to be
    // answerable from the timeline.
    const autonomyChanged = input.autonomy !== undefined && input.autonomy !== before.autonomy;

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: recurrenceAdvanced
        ? 'task.recurred'
        : autonomyChanged
          ? 'task.autonomy_changed'
          : statusChanged
            ? 'task.status_changed'
            : 'task.updated',
      entityType: 'task',
      entityId: task.id,
      meta: recurrenceAdvanced
        ? { title: task.title, from: recurrenceAdvanced.from, to: recurrenceAdvanced.to }
        : autonomyChanged
          ? { title: task.title, from: before.autonomy, to: task.autonomy }
          : statusChanged
            ? { from: before.status, to: task.status, title: task.title }
            : {
                fields: [
                  ...Object.keys(input),
                  ...(labelsParsed.success ? ['labelIds'] : []),
                ],
                title: task.title,
              },
    });

    return json({ task: await getTask(task.id), recurrenceAdvanced });
  });
}

/** DELETE /api/tasks/:id — subtasks are removed by the FK cascade. */
export async function DELETE(_request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Tarea no encontrada');

    const deleted = await deleteTask(id);
    if (!deleted) throw new HttpError(404, 'Tarea no encontrada');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'task.deleted',
      entityType: 'task',
      entityId: id,
    });

    return json({ ok: true });
  });
}
