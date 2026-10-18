import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { createLabel, listLabels } from '@/lib/domain/labels';
import { labelCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/labels */
export async function GET() {
  return route(async () => {
    await requireApiUser();
    return json({ labels: await listLabels() });
  });
}

/** POST /api/labels — idempotent by name. */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, labelCreateSchema);

    const label = await createLabel(input);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'label.created',
      entityType: 'label',
      entityId: label.id,
      meta: { name: label.name },
    });

    return json({ label }, { status: 201 });
  });
}
