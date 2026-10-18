import { HttpError, json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { createNote, DuplicateNoteTitleError, listNotes } from '@/lib/domain/notes';
import { noteCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notes?q=…&projectId=… */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();

    const params = new URL(request.url).searchParams;

    return json({
      notes: await listNotes({
        search: params.get('q') ?? undefined,
        projectId: params.get('projectId') ?? undefined,
      }),
    });
  });
}

/** POST /api/notes */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, noteCreateSchema);

    let detail;
    try {
      detail = await createNote(input);
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
