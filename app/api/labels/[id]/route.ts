import { HttpError, json, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { deleteLabel } from '@/lib/domain/labels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** DELETE /api/labels/:id — the task↔label rows cascade away. */
export async function DELETE(_request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Etiqueta no encontrada');

    const deleted = await deleteLabel(id);
    if (!deleted) throw new HttpError(404, 'Etiqueta no encontrada');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'label.deleted',
      entityType: 'label',
      entityId: id,
    });

    return json({ ok: true });
  });
}
