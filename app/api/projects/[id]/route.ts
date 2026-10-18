import { HttpError, json, parseJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { deleteProject, getProject, updateProject } from '@/lib/domain/projects';
import { projectUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Proyecto no encontrado');

    const project = await getProject(id);
    if (!project) throw new HttpError(404, 'Proyecto no encontrado');

    return json({ project });
  });
}

/** PATCH /api/projects/:id */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Proyecto no encontrado');
    const input = await parseJson(request, projectUpdateSchema);

    const project = await updateProject(id, input);
    if (!project) throw new HttpError(404, 'Proyecto no encontrado');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'project.updated',
      entityType: 'project',
      entityId: project.id,
      meta: { fields: Object.keys(input) },
    });

    return json({ project });
  });
}

/** DELETE /api/projects/:id — tasks are kept, their projectId becomes null. */
export async function DELETE(_request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Proyecto no encontrado');

    const deleted = await deleteProject(id);
    if (!deleted) throw new HttpError(404, 'Proyecto no encontrado');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'project.deleted',
      entityType: 'project',
      entityId: id,
    });

    return json({ ok: true });
  });
}
