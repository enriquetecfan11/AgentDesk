import { HttpError, json, parseJson, route } from '@/lib/api/http';
import { noteFiltersFromUrl } from '@/lib/api/query';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { createNote, DuplicateNoteTitleError, listNotesPage } from '@/lib/domain/notes';
import { noteCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/notes
 *
 * Filters: `q`, `projectId`, `authorType`, `authorId`, `limit`, `offset`.
 * The response carries the page plus `total` and `nextOffset` so a client
 * never has to guess whether there is more.
 */
export async function GET(request: Request) {
  return route(async () => {
    await requireAgent(request, 'notes:read');

    const { filters, limit, offset } = noteFiltersFromUrl(request.url);
    return json(await listNotesPage(filters, limit, offset));
  });
}

/**
 * POST /api/v1/notes
 *
 * Notes written by an agent may already point at other notes with `[[links]]`;
 * the link graph is rebuilt by the domain, so backlinks appear immediately.
 * The author is taken from the token, never from the body.
 */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'notes:write');
    const input = await parseJson(request, noteCreateSchema);

    let detail;
    try {
      detail = await createNote(input, agentActivityActor(actor));
    } catch (error) {
      if (error instanceof DuplicateNoteTitleError) throw new HttpError(409, error.message);
      throw error;
    }

    await logActivity({
      actor: agentActivityActor(actor),
      action: 'note.created',
      entityType: 'note',
      entityId: detail.note.id,
      meta: { title: detail.note.title, via: 'api' },
    });

    return json(detail, { status: 201 });
  });
}
