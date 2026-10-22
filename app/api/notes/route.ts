import { HttpError, json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { noteFiltersFromUrl } from '@/lib/api/query';
import { logActivity } from '@/lib/domain/activity';
import { createNote, DuplicateNoteTitleError, listNotesPage } from '@/lib/domain/notes';
import { noteCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notes
 *
 * Filters: `q`, `projectId`, `authorType`, `authorId`, `limit`, `offset`.
 * The response includes `total` and `nextOffset` alongside the page.
 */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();

    const { filters, limit, offset } = noteFiltersFromUrl(request.url);
    return json(await listNotesPage(filters, limit, offset));
  });
}

/** POST /api/notes */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, noteCreateSchema);

    let detail;
    try {
      detail = await createNote(input, { type: 'human', id: user.id, name: user.name });
    } catch (error) {
      if (error instanceof DuplicateNoteTitleError) throw new HttpError(409, error.message);
      throw error;
    }

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'note.created',
      entityType: 'note',
      entityId: detail.note.id,
      meta: { title: detail.note.title },
    });

    return json(detail, { status: 201 });
  });
}
