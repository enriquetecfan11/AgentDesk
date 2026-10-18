import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { createWebhook, listWebhooks } from '@/lib/domain/webhooks';
import { webhookCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/webhooks */
export async function GET() {
  return route(async () => {
    await requireApiUser();
    return json({ webhooks: await listWebhooks() });
  });
}

/**
 * POST /api/webhooks
 *
 * The signing secret comes back only here, like an API token: it is stored in
 * clear text so it can be shown again, but the list endpoint only carries a
 * preview.
 */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, webhookCreateSchema);

    const created = await createWebhook(input);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'webhook.created',
      entityType: 'webhook',
      entityId: created.webhook.id,
      meta: { name: created.webhook.name, url: created.webhook.url, events: created.webhook.events },
    });

    return json(created, { status: 201 });
  });
}
