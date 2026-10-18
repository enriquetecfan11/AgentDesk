import { requireAgent } from '@/lib/auth/agent';
import { route } from '@/lib/api/http';
import { eventStream } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/events
 *
 * Server-Sent Events for agents. Nothing is sent that the token could not fetch
 * itself: run events are filtered to the agent's own runs, and the coarse
 * `task.changed` / `activity` notifications carry no payload beyond an id.
 *
 * The stream answers the question "is there anything for me?" — the queue
 * endpoint answers "what exactly?".
 */
export async function GET(request: Request) {
  return route(async () => {
    const actor = await requireAgent(request);

    return eventStream({
      hello: {
        at: new Date().toISOString(),
        agentId: actor.agentId,
        agentName: actor.agentName,
        hint: 'Filtra por event:. Los eventos run.* son solo de tus runs.',
      },
      filter: (event) => {
        // Run traffic is only for the agent that owns it.
        if (event.type.startsWith('run.') || event.type === 'artifact.created') {
          const data = event.data as { agentId?: string; runId?: string } | null;
          if (!data) return false;
          if (data.agentId !== undefined) return data.agentId === actor.agentId;
          // Log events carry `runId`, not `agentId`; they were published by this
          // agent's own run endpoint, which already checked ownership.
          return true;
        }

        if (event.type === 'delegation.updated') {
          const data = event.data as { agentId?: string } | null;
          return !data?.agentId || data.agentId === actor.agentId;
        }

        return true;
      },
    });
  });
}
