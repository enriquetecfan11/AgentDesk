import { json, parseJson, route } from '@/lib/api/http';
import { mapNoteError } from '@/lib/api/note-errors';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { appendToNote } from '@/lib/domain/notes';
import { noteAppendSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/notes/append
 *
 * Adds markdown to the end of the note with that title — creating it when it
 * does not exist — so an agent can keep a daily log or a running report
 * without reading the body first. The write is atomic per note: two agents
 * appending at once both land.
 *
 * 201 when the note was created, 200 when it was appended to.
 */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'notes:write');
    const input = await parseJson(request, noteAppendSchema);

    let result;
    try {
      result = await appendToNote(input, agentActivityActor(actor));
    } catch (error) {
      mapNoteError(error);
    }

    await logActivity({
      actor: agentActivityActor(actor),
      action: result.created ? 'note.created' : 'note.appended',
      entityType: 'note',
      entityId: result.detail.note.id,
      meta: {
        title: result.detail.note.title,
        chars: input.contentMd.length,
        via: 'api',
      },
    });

    return json(
      { ...result.detail, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  });
}
