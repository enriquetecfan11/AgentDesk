import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AgentDetail } from '@/components/agents/agent-detail';
import { getAgent, listTokens } from '@/lib/domain/agents';
import { listDelegations } from '@/lib/domain/delegations';
import { listRuns } from '@/lib/domain/runs';
import { listTasks } from '@/lib/domain/tasks';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Ficha de un agente: tokens, delegaciones y runs, todo en una pantalla. */
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const agent = await getAgent(id);
  if (!agent) notFound();

  const [tokens, delegations, runs, tasks] = await Promise.all([
    listTokens(id),
    listDelegations({ agentId: id, limit: 50 }),
    listRuns({ agentId: id, limit: 25 }),
    listTasks({ limit: 200 }),
  ]);

  return (
    <AgentDetail
      agent={agent}
      tokens={tokens}
      delegations={delegations}
      runs={runs}
      // Only the fields the "delegate" dialog needs; the DTO is heavy.
      tasks={tasks.map((task) => ({ id: task.id, title: task.title, status: task.status }))}
      baseUrl={getEnv().APP_BASE_URL}
    />
  );
}
