import { HttpError, json, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { deleteToken, getToken, revokeToken } from '@/lib/domain/agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/**
 * DELETE /api/tokens/:id
 *
 * Revokes by default (the row keeps the audit trail of when the credential was
 * last used); `?hard=true` removes it for good.
 */
export async function DELETE(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Token no encontrado');

    const existing = await getToken(id);
    if (!existing) throw new HttpError(404, 'Token no encontrado');

    const hard = new URL(request.url).searchParams.get('hard') === 'true';

    // Revocar dos veces no es un error, pero solo se registra la primera vez:
    // la actividad debe contar lo que pasó, no lo que se pidió.
    const changed = hard ? await deleteToken(id) : (await revokeToken(id)) !== null;

    if (changed) {
      await logActivity({
        actor: { type: 'human', id: user.id, name: user.name },
        action: hard ? 'agent.token_deleted' : 'agent.token_revoked',
        entityType: 'agent',
        entityId: existing.agentId,
        meta: { prefix: existing.tokenPrefix, name: existing.name },
      });
    }

    return json({ ok: true, changed });
  });
}
