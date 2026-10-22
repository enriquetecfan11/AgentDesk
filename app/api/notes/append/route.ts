import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { mapNoteError } from '@/lib/api/note-errors';
import { logActivity } from '@/lib/domain/activity';
import { appendToNote } from '@/lib/domain/notes';
import { noteAppendSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notes/append
 *
 * The human mirror of the agent endpoint: same body, same semantics, with the
 * session user as the author. Useful for scripts that keep a daily log.
 */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, noteAppendSchema);

    let result;
    try {
      result = await appendToNote(input, { type: 'human', id: user.id, name: user.name });
    } catch (error) {
      mapNoteError(error);
    }

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: result.created ? 'note.created' : 'note.appended',
      entityType: 'note',
      entityId: result.detail.note.id,
      meta: { title: result.detail.note.title, chars: input.contentMd.length },
    });

    return json(
      { ...result.detail, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  });
}
