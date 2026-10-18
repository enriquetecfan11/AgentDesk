import { HttpError, json, parseJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import {
  deleteNote,
  DuplicateNoteTitleError,
  getNote,
  updateNote,
} from '@/lib/domain/notes';
import { noteUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/notes/:id — note, backlinks and outgoing links. */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Nota no encontrada');

    const detail = await getNote(id);
    if (!detail) throw new HttpError(404, 'Nota no encontrada');

    return json(detail);
  });
}

/** PATCH /api/notes/:id */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Nota no encontrada');
    const input = await parseJson(request, noteUpdateSchema);

    let detail;
    try {
      detail = await updateNote(id, input);
    } catch (error) {
      if (error instanceof DuplicateNoteTitleError) throw new HttpError(409, error.message);
      throw error;
    }

    if (!detail) throw new HttpError(404, 'Nota no encontrada');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: input.title !== undefined ? 'note.renamed' : 'note.updated',
      entityType: 'note',
      entityId: detail.note.id,
      meta: { title: detail.note.title, fields: Object.keys(input) },
    });

    return json(detail);
  });
}

/** DELETE /api/notes/:id */
export async function DELETE(_request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Nota no encontrada');

    const detail = await getNote(id);
    if (!detail) throw new HttpError(404, 'Nota no encontrada');

    await deleteNote(id);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'note.deleted',
      entityType: 'note',
      entityId: id,
      meta: { title: detail.note.title },
    });

    return new Response(null, { status: 204 });
  });
}
