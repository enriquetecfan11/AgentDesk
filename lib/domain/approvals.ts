import 'server-only';

import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { approvalDecisionFor } from '@/lib/agent-flow/lease';
import { toolRisk } from '@/lib/agent-flow/policy';
import type { ApprovalStatusValue, RiskLevelValue, TaskStatusValue } from '@/lib/constants';
import { db } from '@/lib/db/client';
import { agents, approvals, tasks, users } from '@/lib/db/schema';
import { emitEvent } from '@/lib/domain/events';
import { createDelegation } from '@/lib/domain/delegations';
import { serializeApproval } from '@/lib/domain/serialize';
import { getEnv } from '@/lib/env';
import type { ApprovalDTO, DelegationDTO } from '@/lib/types';
import type { ApprovalDecisionInput, ApprovalRequestInput } from '@/lib/validation';

/**
 * The human-in-the-loop gate.
 *
 * An approval is an action an agent wanted to take and was not allowed to take
 * alone. AgentDesk is the gate, not the executor: approving `email.send` does
 * not send anything, it tells the agent — which is polling `get_task` — that
 * it may now send it itself. The only action AgentDesk performs on approval is
 * the one that is wholly inside it: `propose_delegation` becomes a real
 * delegation.
 *
 * The three rules, and where each is actually enforced:
 *
 *  - **Fails closed.** `expireApprovals()` runs before every read, and
 *    `approvalDecisionFor` reports a lapsed row as `rejected`. Even if the
 *    sweep never ran, nothing reads an overdue row as still open.
 *  - **A decision is never overwritten.** `decideApproval` updates with
 *    `status = 'pending'` in the WHERE. A second decision matches no row, and
 *    zero rows is a 409 — not a last-write-wins.
 *  - **An agent never approves its own work.** `decideApproval` takes a
 *    `SessionUser`, is only reachable from a cookie-authenticated route, and
 *    there is no MCP tool or `/api/v1` path that calls it.
 */

const SELECTION = {
  approval: approvals,
  task: { id: tasks.id, title: tasks.title, status: tasks.status },
  agent: { id: agents.id, name: agents.name },
  decidedByUserName: users.name,
};

type ApprovalRow = {
  approval: typeof approvals.$inferSelect;
  task: { id: string; title: string; status: TaskStatusValue } | null;
  agent: { id: string; name: string } | null;
  decidedByUserName: string | null;
};

function hydrate(row: ApprovalRow): ApprovalDTO {
  return serializeApproval({
    ...row.approval,
    // A left join yields a row of nulls rather than null itself.
    task: row.task?.id ? row.task : null,
    agent: row.agent?.id ? row.agent : null,
    decidedByUserName: row.decidedByUserName,
  });
}

function baseQuery() {
  return db
    .select(SELECTION)
    .from(approvals)
    .leftJoin(tasks, eq(tasks.id, approvals.taskId))
    .leftJoin(agents, eq(agents.id, approvals.agentId))
    .leftJoin(users, eq(users.id, approvals.decidedByUserId));
}

/**
 * Flips every overdue pending row to `expired`.
 *
 * One statement, idempotent, and cheap thanks to the partial index on
 * `(expires_at) where status = 'pending'`. Called at the head of each read
 * instead of from a scheduler: the state is then correct for whoever asked,
 * which is the only moment it matters.
 */
export async function expireApprovals(): Promise<number> {
  const rows = await db
    .update(approvals)
    .set({ status: 'expired', updatedAt: new Date() })
    .where(and(eq(approvals.status, 'pending'), sql`${approvals.expiresAt} <= now()`))
    .returning({ id: approvals.id, taskId: approvals.taskId, agentId: approvals.agentId });

  for (const row of rows) {
    emitEvent('approval.decided', {
      id: row.id,
      taskId: row.taskId,
      agentId: row.agentId,
      status: 'expired',
      decision: 'rejected',
    });
  }

  return rows.length;
}

export type ApprovalFilters = {
  statuses?: ApprovalStatusValue[];
  taskId?: string;
  agentId?: string;
  limit?: number;
};

export async function listApprovals(filters: ApprovalFilters = {}): Promise<ApprovalDTO[]> {
  await expireApprovals();

  const conditions = [];
  if (filters.statuses?.length) conditions.push(inArray(approvals.status, filters.statuses));
  if (filters.taskId) conditions.push(eq(approvals.taskId, filters.taskId));
  if (filters.agentId) conditions.push(eq(approvals.agentId, filters.agentId));

  const rows = await baseQuery()
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    // Pending first, then newest: the inbox is a to-do list, not an archive.
    .orderBy(sql`case when ${approvals.status} = 'pending' then 0 else 1 end`, desc(approvals.createdAt))
    .limit(filters.limit ?? 200);

  return rows.map(hydrate);
}

export async function getApproval(id: string): Promise<ApprovalDTO | null> {
  await expireApprovals();

  const [row] = await baseQuery().where(eq(approvals.id, id)).limit(1);
  return row ? hydrate(row) : null;
}

/** The approvals hanging off one task — what `get_task` hands the agent. */
export async function listApprovalsForTask(taskId: string): Promise<ApprovalDTO[]> {
  return listApprovals({ taskId, limit: 50 });
}

export async function countPendingApprovals(): Promise<number> {
  await expireApprovals();

  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(approvals)
    .where(eq(approvals.status, 'pending'));

  return row?.value ?? 0;
}

export type CreateApprovalInput = ApprovalRequestInput & {
  agentId: string;
  /** Overrides the risk the tool catalogue would assign. */
  risk?: RiskLevelValue;
};

/**
 * Parks an action.
 *
 * `idempotencyKey` exists because a runner that times out waiting for an
 * answer will call again, and two identical rows in the inbox is a worse
 * outcome than one: you would have to decide the same thing twice, and the
 * second decision would contradict the "a decision is never overwritten" rule
 * from the agent's point of view. The key returns the row that already exists.
 */
export async function createApproval(input: CreateApprovalInput): Promise<ApprovalDTO> {
  if (input.idempotencyKey) {
    const [existing] = await baseQuery()
      .where(
        and(
          eq(approvals.agentId, input.agentId),
          eq(approvals.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);

    if (existing) return hydrate(existing);
  }

  const ttl = getEnv().AGENTDESK_APPROVAL_TTL_SECONDS;

  const [row] = await db
    .insert(approvals)
    .values({
      taskId: input.taskId,
      agentId: input.agentId,
      runId: input.runId ?? null,
      tool: input.tool,
      risk: input.risk ?? toolRisk(input.tool),
      status: 'pending',
      title: input.title,
      summary: input.summary ?? null,
      payload: input.payload ?? {},
      expiresAt: sql`now() + make_interval(secs => ${ttl})`,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .returning({ id: approvals.id });

  const approval = (await getApproval(row.id))!;
  emitEvent('approval.requested', {
    id: approval.id,
    taskId: approval.taskId,
    agentId: approval.agentId,
    tool: approval.tool,
    risk: approval.risk,
    approval,
  });
  return approval;
}

export type DecideResult =
  | { ok: true; approval: ApprovalDTO; delegation: DelegationDTO | null }
  /** Somebody (or the clock) already answered. The current state comes back. */
  | { ok: false; reason: 'already_decided'; approval: ApprovalDTO }
  | { ok: false; reason: 'not_found'; approval: null };

/**
 * Records the one decision an approval gets.
 *
 * The guard is `status = 'pending'` inside the UPDATE, so two tabs deciding at
 * the same moment cannot both win: the loser gets `already_decided` and sees
 * what the winner chose. The expiry sweep runs first, which means an approval
 * whose deadline passed while the dialog was open is already `expired` and the
 * decision is refused — the fail-closed rule, applied to the person too.
 */
export async function decideApproval(
  id: string,
  user: { id: string; name: string },
  input: ApprovalDecisionInput,
): Promise<DecideResult> {
  await expireApprovals();

  const status: ApprovalStatusValue =
    input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'cancelled';

  // An edit lands in `payloadEdited`; `payload` keeps what the agent sent, so
  // the inbox can always show the two side by side.
  const edited = input.action === 'approve' && input.payload !== undefined ? input.payload : undefined;

  const [row] = await db
    .update(approvals)
    .set({
      status,
      reason: input.reason ?? null,
      ...(edited === undefined ? {} : { payloadEdited: edited }),
      decidedByUserId: user.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(approvals.id, id), eq(approvals.status, 'pending')))
    .returning({ id: approvals.id });

  if (!row) {
    const current = await getApproval(id);
    if (!current) return { ok: false, reason: 'not_found', approval: null };
    return { ok: false, reason: 'already_decided', approval: current };
  }

  const approval = (await getApproval(id))!;

  // The one thing AgentDesk executes itself: a delegation it owns end to end.
  const delegation =
    status === 'approved' && approval.tool === 'propose_delegation'
      ? await materialiseDelegation(approval, user)
      : null;

  emitEvent('approval.decided', {
    id: approval.id,
    taskId: approval.taskId,
    agentId: approval.agentId,
    status: approval.status,
    decision: approvalDecisionFor({ status: approval.status, expiresAt: approval.expiresAt }),
    approval,
  });

  return { ok: true, approval, delegation };
}

/**
 * Turns an approved `propose_delegation` into the real thing.
 *
 * `requiresApproval` is false on purpose: the gate the delegation would open
 * is the gate that was just cleared, and asking twice for the same permission
 * is how an inbox stops being read.
 */
async function materialiseDelegation(
  approval: ApprovalDTO,
  user: { id: string; name: string },
): Promise<DelegationDTO | null> {
  const payload = approval.payloadEdited ?? approval.payload;
  const toAgentId = typeof payload.toAgentId === 'string' ? payload.toAgentId : null;
  if (!toAgentId) return null;

  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : approval.title;
  const instructions = typeof payload.instructions === 'string' ? payload.instructions : null;

  return createDelegation(
    {
      toAgentId,
      title,
      instructions,
      taskId: approval.taskId,
      requiresApproval: false,
    },
    { type: 'human', id: user.id, name: user.name },
  );
}
