import { HttpError, json, parseJson, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { createNote, DuplicateNoteTitleError, listNotes } from '@/lib/domain/notes';
import { noteCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/notes?q=…&projectId=… */
export async function GET(request: Request) {
  return route(async () => {
    await requireAgent(request, 'notes:read');

    const params = new URL(request.url).searchParams;
    return json({
      notes: await listNotes({
        search: params.get('q') ?? undefined,
        projectId: params.get('projectId') ?? undefined,
      }),
    });
  });
}

/**
 * POST /api/v1/notes
 *
 * Notes written by an agent may already point at other notes with `[[links]]`;
 * the link graph is rebuilt by the domain, so backlinks appear immediately.
 */
export async function POST(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'notes:write');
    const input = await parseJson(request, noteCreateSchema);

    let detail;
    try {
      detail = await createNote(input);
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
