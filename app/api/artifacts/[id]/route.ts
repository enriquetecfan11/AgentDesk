import { HttpError, requireUuid, route } from '@/lib/api/http';
import { getSessionUser } from '@/lib/auth/session';
import { requireAgent } from '@/lib/auth/agent';
import { getArtifactRow } from '@/lib/domain/runs';
import { readUpload } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * GET /api/artifacts/:id
 *
 * Text artifacts come back inline; files are streamed from the uploads volume.
 * Accepts either a session cookie (the UI) or a bearer token with `runs:read`
 * (an agent fetching what another agent produced).
 */
export async function GET(request: Request, { params }: Context) {
  return route(async () => {
    const id = requireUuid((await params).id, 'Artefacto no encontrado');

    const session = await getSessionUser();
    if (!session) await requireAgent(request, 'runs:read');

    const row = await getArtifactRow(id);
    if (!row) throw new HttpError(404, 'Artefacto no encontrado');

    if (row.kind === 'text' || row.kind === 'url') {
      return new Response(row.content ?? '', {
        headers: {
          'Content-Type': `${row.mimeType ?? 'text/plain'}; charset=utf-8`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (!row.storagePath) throw new HttpError(404, 'El artefacto no tiene fichero asociado');

    const bytes = await readUpload(row.storagePath);
    const fileName = row.name.replace(/[\r\n"\\]/g, '_');

    return new Response(new Blob([bytes as BlobPart], { type: row.mimeType ?? 'application/octet-stream' }), {
      headers: {
        'Content-Type': row.mimeType ?? 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
