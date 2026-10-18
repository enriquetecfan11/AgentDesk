import { HttpError, json, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { testWebhook } from '@/lib/domain/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/:id/test
 *
 * Delivers a `test` event and waits for the answer. Every other delivery is
 * fire-and-forget; this one exists so the settings screen can show what the
 * endpoint actually replied, which is the difference between "n8n is broken"
 * and "the URL has a typo".
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Webhook no encontrado');

    const result = await testWebhook(id);
    if (!result) throw new HttpError(404, 'Webhook no encontrado');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'webhook.tested',
      entityType: 'webhook',
      entityId: id,
      meta: { ok: result.ok, status: result.status, durationMs: result.durationMs },
    });

    return json({ result });
  });
}
