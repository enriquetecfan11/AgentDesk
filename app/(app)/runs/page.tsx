import { RunsWorkspace } from '@/components/runs/runs-workspace';
import { listAgents } from '@/lib/domain/agents';
import { listRuns } from '@/lib/domain/runs';

export const dynamic = 'force-dynamic';

/**
 * Runs.
 *
 * El listado llega filtrado del servidor cuando la URL trae `?agentId=`, de
 * modo que "Ver todos" desde la ficha de un agente enlaza a algo ya acotado.
 */
export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ agentId?: string }>;
}) {
  const { agentId } = await searchParams;

  const [runs, agents] = await Promise.all([
    listRuns({ agentId: agentId || undefined, limit: 200 }),
    listAgents({ includeArchived: true }),
  ]);

  return (
    <RunsWorkspace
      initialRuns={runs}
      agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
      initialAgentId={agentId}
    />
  );
}
