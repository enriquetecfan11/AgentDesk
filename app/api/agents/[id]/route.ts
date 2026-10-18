import { HttpError, json, parseJson, requireApiUser, requireUuid, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { deleteAgent, getAgent, listTokens, updateAgent } from '@/lib/domain/agents';
import { listDelegations } from '@/lib/domain/delegations';
import { listRuns } from '@/lib/domain/runs';
import { agentUpdateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

/** GET /api/agents/:id — agent, its tokens, its delegations and its recent runs. */
export async function GET(_request: Request, { params }: Context) {
  return route(async () => {
    await requireApiUser();
    const id = requireUuid((await params).id, 'Agente no encontrado');

    const agent = await getAgent(id);
    if (!agent) throw new HttpError(404, 'Agente no encontrado');

    const [tokens, delegations, runs] = await Promise.all([
      listTokens(id),
      listDelegations({ agentId: id, limit: 50 }),
      listRuns({ agentId: id, limit: 25 }),
    ]);

    return json({ agent, tokens, delegations, runs });
  });
}

/** PATCH /api/agents/:id */
export async function PATCH(request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Agente no encontrado');
    const input = await parseJson(request, agentUpdateSchema);

    const agent = await updateAgent(id, input);
    if (!agent) throw new HttpError(404, 'Agente no encontrado');

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'agent.updated',
      entityType: 'agent',
      entityId: id,
      meta: { fields: Object.keys(input), name: agent.name },
    });

    return json({ agent });
  });
}

/** DELETE /api/agents/:id — tokens, delegations and runs go with it. */
export async function DELETE(_request: Request, { params }: Context) {
  return route(async () => {
    const user = await requireApiUser();
    const id = requireUuid((await params).id, 'Agente no encontrado');

    const agent = await getAgent(id);
    if (!agent) throw new HttpError(404, 'Agente no encontrado');

    await deleteAgent(id);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'agent.deleted',
      entityType: 'agent',
      entityId: id,
      meta: { name: agent.name },
    });

    return json({ ok: true });
  });
}
