import { requireAgent } from '@/lib/auth/agent';
import { json, route } from '@/lib/api/http';
import { getQueue } from '@/lib/domain/delegations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/me
 *
 * The first call any agent makes: who am I, what am I allowed to do, and is
 * there work waiting. Needs a valid token but no particular scope, so a
 * misconfigured token can still find out what is wrong with it.
 */
export async function GET(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request);
    const queue = await getQueue(actor.agentId);

    return json({
      agent: {
        id: actor.agentId,
        name: actor.agentName,
        status: actor.agentStatus,
        capabilities: queue?.agent.capabilities ?? [],
      },
      tokenId: actor.tokenId,
      scopes: actor.scopes,
      queue: {
        delegations: queue?.delegations.length ?? 0,
        tasks: queue?.tasks.length ?? 0,
      },
      serverTime: new Date().toISOString(),
    });
  });
}
