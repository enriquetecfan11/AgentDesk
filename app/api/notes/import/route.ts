import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { importNotes } from '@/lib/domain/notes';
import { noteImportSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notes/import
 *
 * Body: `{ files: [{ name, content }], overwrite?: boolean }`.
 *
 * The browser reads the selected `.md` files and sends their text; the server
 * never has to open an archive, which keeps the import path free of a ZIP
 * parser and of its decompression bombs.
 */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, noteImportSchema);

    const summary = await importNotes(input, { type: 'human', id: user.id, name: user.name });

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'note.imported',
      entityType: 'note',
      meta: {
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
      },
    });

    return json(summary);
  });
}
