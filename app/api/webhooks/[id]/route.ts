import { HttpError, json, parseJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { deleteWebhook, getWebhook, updateWebhook } from '@/lib/domain/webhooks';
import { webhookUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** GET /api/webhooks/:id */
export async function GET(_request: Request, { params }: Params) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Webhook no encontrado');

    const webhook = await getWebhook(id);
    if (!webhook) throw new HttpError(404, 'Webhook no encontrado');

    return json({ webhook });
  });
}

/**
 * PATCH /api/webhooks/:id
 *
 * `rotateSecret: true` issues a new secret and returns it once, exactly like
 * creation does.
 */
export async function PATCH(request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Webhook no encontrado');
    const input = await parseJson(request, webhookUpdateSchema);

    const updated = await updateWebhook(id, input);
    if (!updated) throw new HttpError(404, 'Webhook no encontrado');

    if (input.rotateSecret) {
      await logActivity({
        actor: { type: 'human', id: user.id, name: user.name },
        action: 'webhook.secret_rotated',
        entityType: 'webhook',
        entityId: id,
        meta: { name: updated.webhook.name },
      });
    } else {
      await logActivity({
        actor: { type: 'human', id: user.id, name: user.name },
        action: 'webhook.updated',
        entityType: 'webhook',
        entityId: id,
        meta: { name: updated.webhook.name, active: updated.webhook.active, events: updated.webhook.events },
      });
    }

    return json(updated);
  });
}

/** DELETE /api/webhooks/:id */
export async function DELETE(_request: Request, { params }: Params) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Webhook no encontrado');

    const existing = await getWebhook(id);
    if (!existing) throw new HttpError(404, 'Webhook no encontrado');

    await deleteWebhook(id);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: id,
      meta: { name: existing.name, url: existing.url },
    });

    return json({ ok: true });
  });
}
