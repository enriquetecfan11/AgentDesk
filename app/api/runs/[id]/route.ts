import { HttpError, json, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { getRunDetail } from '@/lib/domain/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/runs/:id — the run with its log tail and its artifacts.
 *
 * The page loads this once and then follows `/api/events`; a client that has
 * been away can ask again with the whole log included.
 */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Run no encontrado');

    const detail = await getRunDetail(id);
    if (!detail) throw new HttpError(404, 'Run no encontrado');

    return json(detail);
  });
}
