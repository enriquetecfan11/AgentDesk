import { HttpError, json, parseJson, requireUuid, route } from '@/lib/api/http';
import { agentActivityActor, requireAgent } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { DuplicateNoteTitleError, getNote, updateNote } from '@/lib/domain/notes';
import { noteUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/v1/notes/:id — the note, with its backlinks and outgoing links. */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    await requireAgent(request, 'notes:read');
    const id = requireUuid((await params).id, 'Nota no encontrada');

    const detail = await getNote(id);
    if (!detail) throw new HttpError(404, 'Nota no encontrada');

    return json(detail);
  });
}

/** PATCH /api/v1/notes/:id */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const actor = await requireAgent(request, 'notes:write');
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
      actor: agentActivityActor(actor),
      action: input.title !== undefined ? 'note.renamed' : 'note.updated',
      entityType: 'note',
      entityId: id,
      meta: { title: detail.note.title, fields: Object.keys(input), via: 'api' },
    });

    return json(detail);
  });
}
