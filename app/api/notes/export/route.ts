import { requireApiUser, route } from '@/lib/api/http';
import { exportNotes } from '@/lib/domain/notes';
import { formatDateOnly } from '@/lib/dates';
import { createZip } from '@/lib/zip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/notes/export
 *
 * One `.md` per note, with YAML frontmatter, inside a ZIP. Unzipping it into a
 * folder gives a vault Obsidian can open directly.
 */
export async function GET() {
  return route(async () => {
    await requireApiUser();

    const files = await exportNotes();
    const zip = createZip(
      files.map((file) => ({ name: file.fileName, content: file.contents })),
    );

    return new Response(new Blob([zip as BlobPart], { type: 'application/zip' }), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="agentdesk-notas-${formatDateOnly(new Date())}.zip"`,
        'Cache-Control': 'no-store',
        // Lets the UI show how many notes were exported without a second call.
        'X-Note-Count': String(files.length),
      },
    });
  });
}
