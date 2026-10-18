import { json, parseJson, requireApiUser, route } from '@/lib/api/http';
import { logActivity } from '@/lib/domain/activity';
import { createAgent, listAgents } from '@/lib/domain/agents';
import { agentCreateSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agents */
export async function GET(request: Request) {
  return route(async () => {
    await requireApiUser();

    const includeArchived = new URL(request.url).searchParams.get('archived') === 'true';
    return json({ agents: await listAgents({ includeArchived }) });
  });
}

/** POST /api/agents */
export async function POST(request: Request) {
  return route(async () => {
    const user = await requireApiUser();
    const input = await parseJson(request, agentCreateSchema);

    const agent = await createAgent(input);

    await logActivity({
      actor: { type: 'human', id: user.id, name: user.name },
      action: 'agent.created',
      entityType: 'agent',
      entityId: agent.id,
      meta: { name: agent.name, capabilities: agent.capabilities },
    });

    return json({ agent }, { status: 201 });
  });
}
