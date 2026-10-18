import { AgentsWorkspace } from '@/components/agents/agents-workspace';
import { listAgents } from '@/lib/domain/agents';

export const dynamic = 'force-dynamic';

/** Agentes: identidades con token propio, cola de trabajo y runs. */
export default async function AgentsPage() {
  const agents = await listAgents({ includeArchived: true });

  return <AgentsWorkspace initialAgents={agents} />;
}
