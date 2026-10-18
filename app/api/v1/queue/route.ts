import { requireAgent } from '@/lib/auth/agent';
import { json, route } from '@/lib/api/http';
import { getQueue } from '@/lib/domain/delegations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/queue
 *
 * Everything the agent should be looking at: delegations it can pick up and
 * tasks assigned to it that are still open. This is the endpoint an agent
 * polls (or is woken for, through `/api/v1/events`).
 */
export async function GET(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request, 'delegations:read');
    const queue = await getQueue(actor.agentId);

    if (!queue) return json({ error: 'Agente no encontrado' }, { status: 404 });

    return json(queue);
  });
}
