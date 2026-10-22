import { HttpError, json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { mapNoteError } from '@/lib/api/note-errors';
import { logActivity } from '@/lib/domain/activity';
import { getNoteByTitle, upsertNoteByTitle } from '@/lib/domain/notes';
import { noteUpsertSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notes/by-title?title=… */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();

    const title = new URL(request.url).searchParams.get('title')?.trim();
    if (!title) throw new HttpError(422, 'Falta el parámetro title');

    const detail = await getNoteByTitle(title);
    if (!detail) throw new HttpError(404, 'Nota no encontrada');

    return json(detail);
  });
}

/** PUT /api/notes/by-title — create-or-replace addressed by title. */
export async function PUT(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, noteUpsertSchema);

    let result;
    try {
      result = await upsertNoteByTitle(input, { type: 'human', id: user.id, name: user.name });
    } catch (error) {
      mapNoteError(error);
    }

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: result.created ? 'note.created' : 'note.updated',
      entityType: 'note',
      entityId: result.detail.note.id,
      meta: { title: result.detail.note.title, upsert: true },
    });

    return json(
      { ...result.detail, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  });
}
