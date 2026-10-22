import { HttpError, json, parseJson, route } from '@/lib/api/http';
import { mapNoteError } from '@/lib/api/note-errors';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { getNoteByTitle, upsertNoteByTitle } from '@/lib/domain/notes';
import { noteUpsertSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/notes/by-title?title=…
 *
 * The title travels as a query parameter, not as a path segment: notes are
 * named things like "Plan de migración" or "a/b", and a path would need
 * escaping rules that clients get wrong.
 */
export async function GET(request: Request) {
  return route(async () => {
    await requireAgent(request, 'notes:read');

    const title = new URL(request.url).searchParams.get('title')?.trim();
    if (!title) throw new HttpError(422, 'Falta el parámetro title');

    const detail = await getNoteByTitle(title);
    if (!detail) throw new HttpError(404, 'Nota no encontrada');

    return json(detail);
  });
}

/**
 * PUT /api/v1/notes/by-title
 *
 * Creates the note when it does not exist and replaces its body when it does.
 * `createIfMissing: false` turns a missing note into a 404; `expectedUpdatedAt`
 * turns a concurrent edit into a 409 instead of a silent overwrite.
 *
 * 201 when the note was created, 200 when it was replaced.
 */
export async function PUT(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'notes:write');
    const input = await parseJson(request, noteUpsertSchema);

    let result;
    try {
      result = await upsertNoteByTitle(input, agentActivityActor(actor));
    } catch (error) {
      mapNoteError(error);
    }

    await logActivity({
      actor: agentActivityActor(actor),
      action: result.created ? 'note.created' : 'note.updated',
      entityType: 'note',
      entityId: result.detail.note.id,
      meta: { title: result.detail.note.title, via: 'api', upsert: true },
    });

    return json(
      { ...result.detail, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  });
}
