import 'server-only';

import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';

import {
  OPEN_DELEGATION_STATUSES,
  type DelegationStatusValue,
} from '@/lib/constants';
import { db } from '@/lib/db/client';
import { agents, delegations, tasks } from '@/lib/db/schema';
import { emitEvent } from '@/lib/domain/events';
import { serializeDelegation } from '@/lib/domain/serialize';
import type { ActivityActor } from '@/lib/domain/activity';
import type { DelegationDTO, QueueDTO } from '@/lib/types';
import type { DelegationCreateInput } from '@/lib/validation';
import { listTasks } from '@/lib/domain/tasks';

export type DelegationFilters = {
  agentId?: string;
  taskId?: string;
  statuses?: DelegationStatusValue[];
  /** Only what an agent can actually pick up. */
  actionableOnly?: boolean;
  limit?: number;
};

const SELECTION = {
  delegation: delegations,
  agent: { id: agents.id, name: agents.name },
  task: { id: tasks.id, title: tasks.title, status: tasks.status },
};

export async function listDelegations(
  filters: DelegationFilters = {},
): Promise<DelegationDTO[]> {
  const conditions = [];

  if (filters.agentId) conditions.push(eq(delegations.toAgentId, filters.agentId));
  if (filters.taskId) conditions.push(eq(delegations.taskId, filters.taskId));
  if (filters.statuses?.length) conditions.push(inArray(delegations.status, filters.statuses));

  if (filters.actionableOnly) {
    conditions.push(inArray(delegations.status, OPEN_DELEGATION_STATUSES));
    // Either approval was never needed, or a human already gave it.
    conditions.push(or(eq(delegations.requiresApproval, false), isNotNull(delegations.approvedAt)));
  }

  const rows = await db
    .select(SELECTION)
    .from(delegations)
    .leftJoin(agents, eq(agents.id, delegations.toAgentId))
    .leftJoin(tasks, eq(tasks.id, delegations.taskId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(delegations.createdAt))
    .limit(filters.limit ?? 200);

  return rows.map((row) =>
    serializeDelegation(row.delegation, {
      agent: row.agent?.id ? row.agent : null,
      task: row.task?.id ? (row.task as { id: string; title: string; status: string }) : null,
    }),
  );
}

export async function getDelegation(id: string): Promise<DelegationDTO | null> {
  const [row] = await db
    .select(SELECTION)
    .from(delegations)
    .leftJoin(agents, eq(agents.id, delegations.toAgentId))
    .leftJoin(tasks, eq(tasks.id, delegations.taskId))
    .where(eq(delegations.id, id))
    .limit(1);

  if (!row) return null;

  return serializeDelegation(row.delegation, {
    agent: row.agent?.id ? row.agent : null,
    task: row.task?.id ? (row.task as { id: string; title: string; status: string }) : null,
  });
}

export async function createDelegation(
  input: DelegationCreateInput,
  from: ActivityActor,
): Promise<DelegationDTO> {
  const [row] = await db
    .insert(delegations)
    .values({
      fromType: from.type,
      fromId: from.id ?? null,
      toAgentId: input.toAgentId,
      taskId: input.taskId ?? null,
      title: input.title,
      instructions: input.instructions ?? null,
      requiresApproval: input.requiresApproval,
      status: 'pending',
    })
    .returning();

  const delegation = (await getDelegation(row.id))!;
  emitEvent('delegation.updated', { id: delegation.id, status: delegation.status, delegation });
  return delegation;
}

export type DelegationTransition = {
  status: DelegationStatusValue;
  /** Set by a human when clearing an approval gate. */
  approve?: boolean;
};

/**
 * Moves a delegation along.
 *
 * The states are not policed with a strict machine: an agent that fails twice
 * and then succeeds is normal, and refusing the transition would only push the
 * bookkeeping into the agent. What is enforced is that closing a delegation
 * stamps the approval when one was required.
 */
export async function updateDelegationStatus(
  id: string,
  input: DelegationTransition,
): Promise<DelegationDTO | null> {
  const patch: Partial<typeof delegations.$inferInsert> = {
    status: input.status,
    updatedAt: new Date(),
  };

  if (input.approve) patch.approvedAt = new Date();

  const [row] = await db.update(delegations).set(patch).where(eq(delegations.id, id)).returning();
  if (!row) return null;

  const delegation = (await getDelegation(id))!;
  emitEvent('delegation.updated', {
    id,
    status: delegation.status,
    agentId: delegation.toAgentId,
    delegation,
  });
  return delegation;
}

export async function deleteDelegation(id: string): Promise<boolean> {
  const rows = await db
    .delete(delegations)
    .where(eq(delegations.id, id))
    .returning({ id: delegations.id });
  return rows.length > 0;
}

export async function countPendingApprovals(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(delegations)
    .where(
      and(
        eq(delegations.requiresApproval, true),
        eq(delegations.status, 'pending'),
        sql`${delegations.approvedAt} is null`,
      ),
    );

  return row?.value ?? 0;
}

/**
 * The work an agent should be looking at right now: delegations it can pick up
 * and tasks assigned to it that are still open.
 */
export async function getQueue(agentId: string): Promise<QueueDTO | null> {
  const [agent] = await db
    .select({
      id: agents.id,
      name: agents.name,
      status: agents.status,
      capabilities: agents.capabilities,
    })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent) return null;

  const [queueDelegations, assignedTasks] = await Promise.all([
    listDelegations({ agentId, actionableOnly: true, limit: 100 }),
    listTasks({ assigneeType: 'agent', assigneeId: agentId, limit: 100 }),
  ]);

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      capabilities: agent.capabilities ?? [],
    },
    // Oldest first: the queue is meant to be worked through, not admired.
    delegations: queueDelegations.reverse(),
    tasks: assignedTasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled'),
  };
}

/** Used by the agent profile page: what this agent has been asked to do. */
export async function listDelegationsForAgent(agentId: string, limit = 30) {
  return listDelegations({ agentId, limit });
}

export async function countDelegationsByStatus(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: delegations.status, value: sql<number>`count(*)`.mapWith(Number) })
    .from(delegations)
    .groupBy(delegations.status);

  return Object.fromEntries(rows.map((row) => [row.status, row.value]));
}
