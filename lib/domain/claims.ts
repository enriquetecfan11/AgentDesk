import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { getEnv } from '@/lib/env';
import { db, getSql } from '@/lib/db/client';
import { tasks, type TaskStatus } from '@/lib/db/schema';
import { logActivity } from '@/lib/domain/activity';
import { emitEvent } from '@/lib/domain/events';
import { getTask } from '@/lib/domain/tasks';
import type { TaskDTO } from '@/lib/types';

/**
 * Task leases: one agent at a time, and only for a while.
 *
 * Without this, two runners polling the same queue get handed the same task
 * and both open a run on it. The lease is what makes concurrency safe, and the
 * expiry is what makes a dead runner recoverable — the two halves of the same
 * problem.
 *
 * Everything here is a **single conditional statement**. The read-modify-write
 * shape used elsewhere (`lib/domain/tasks.ts:updateTask`) cannot express "take
 * it only if nobody else has": between the SELECT and the UPDATE another
 * runner fits. So the guard travels inside the WHERE, and zero affected rows
 * *is* the answer.
 */

/** Statuses a task can be claimed in. A closed task is not work. */
const CLAIMABLE: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review'];

/** Where an expired lease puts the task back. This schema's "pending". */
const RECLAIM_STATUS: TaskStatus = 'todo';

function leaseTtlSeconds(): number {
  return getEnv().AGENTDESK_LEASE_TTL_SECONDS;
}

function leaseExpiry() {
  return sql`now() + make_interval(secs => ${leaseTtlSeconds()})`;
}

/**
 * Raw rows come back exactly as Postgres names them.
 *
 * `lib/db/client.ts` builds the pool without a key transform, so a
 * `getSql()` query yields snake_case columns — not the camelCase a Drizzle
 * select would give. Spelling that out in a type is cheaper than discovering
 * it through a field that is quietly `undefined`.
 */
type ClaimedRow = {
  id: string;
  title: string;
  claim_id: string;
  claimed_by_agent_id: string;
  lease_expires_at: Date;
  previous_agent_id: string | null;
};

export type ClaimFailure = 'not_found' | 'held' | 'closed';

export type ClaimResult =
  | {
      ok: true;
      task: TaskDTO;
      claimId: string;
      leaseExpiresAt: string;
      /** True when the agent already held it and only pushed the deadline out. */
      renewed: boolean;
    }
  | { ok: false; reason: ClaimFailure; heldBy?: string | null };

async function describeFailure(taskId: string, agentId: string): Promise<ClaimResult> {
  const [row] = await db
    .select({
      status: tasks.status,
      claimedByAgentId: tasks.claimedByAgentId,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);

  if (!row) return { ok: false, reason: 'not_found' };
  if (!CLAIMABLE.includes(row.status)) return { ok: false, reason: 'closed' };

  // The only remaining reason the guard can have failed: somebody else holds a
  // live lease on it.
  return {
    ok: false,
    reason: 'held',
    heldBy: row.claimedByAgentId === agentId ? null : row.claimedByAgentId,
  };
}

/**
 * Takes the task, or says why it could not.
 *
 * One statement, and a `for update` row lock inside the CTE so the guard and
 * the write cannot be separated. The CTE also carries the *previous* holder
 * out through `returning` — `returning tasks.*` alone would only ever show the
 * value after the write, which is useless for telling a fresh claim from a
 * renewal.
 *
 * Calling it on a task the agent already holds **renews the lease**: that is
 * the heartbeat. There is no separate heartbeat tool — a runner that is
 * working is a runner that is calling something, and every call it makes on
 * its own task pushes the deadline out (see `renewLease`).
 */
export async function claimTask(taskId: string, agentId: string): Promise<ClaimResult> {
  const sqlClient = getSql();

  const rows = await sqlClient<ClaimedRow[]>`
    with before as (
      select id, status, claimed_by_agent_id, lease_expires_at
      from tasks
      where id = ${taskId}::uuid
      for update
    )
    update tasks set
      claimed_by_agent_id = ${agentId}::uuid,
      -- A fresh generation on every claim, so a runner that comes back from
      -- the dead with the old one cannot close work that moved on.
      claim_id            = gen_random_uuid(),
      lease_expires_at    = now() + make_interval(secs => ${leaseTtlSeconds()}),
      heartbeat_at        = now(),
      claim_count         = tasks.claim_count + 1,
      assignee_type       = 'agent',
      assignee_id         = ${agentId}::uuid,
      -- Taking a task starts it; one already in review stays there.
      status              = case
                              when before.status in ('backlog','todo') then 'in_progress'::task_status
                              else before.status
                            end,
      updated_at          = now()
    from before
    where tasks.id = before.id
      and before.status in ('backlog','todo','in_progress','review')
      and (
        before.claimed_by_agent_id is null
        or before.claimed_by_agent_id = ${agentId}::uuid
        or before.lease_expires_at < now()
      )
    returning tasks.id, tasks.title, tasks.claim_id, tasks.claimed_by_agent_id,
              tasks.lease_expires_at, before.claimed_by_agent_id as previous_agent_id
  `;

  const row = rows[0];
  if (!row) return describeFailure(taskId, agentId);

  return buildSuccess(row, row.previous_agent_id === agentId);
}

async function buildSuccess(row: ClaimedRow, renewed: boolean): Promise<ClaimResult> {
  const task = (await getTask(row.id))!;

  if (!renewed) {
    emitEvent('task.claimed', {
      id: task.id,
      agentId: row.claimed_by_agent_id,
      leaseExpiresAt: row.lease_expires_at,
      task,
    });
    emitEvent('task.changed', { id: task.id, action: 'updated', task });
  }

  return {
    ok: true,
    task,
    claimId: row.claim_id,
    leaseExpiresAt: new Date(row.lease_expires_at).toISOString(),
    renewed,
  };
}

export type NextTaskFilters = {
  projectId?: string;
  /** Also consider unassigned tasks, not only the agent's own. Default true. */
  includeUnassigned?: boolean;
};

/**
 * Claims the first task the agent should work on, in one statement.
 *
 * `for update skip locked` is the whole trick: two runners that fire at the
 * same instant lock different rows instead of fighting over one and handing
 * one of them a duplicate. Written with the raw handle because Drizzle has no
 * expression for a locking CTE — which is exactly what `getSql()` exists for.
 *
 * Tasks on `suggest_only` are not candidates. They are still visible through
 * `list_tasks`, and the agent can comment on them and propose things for them;
 * what it cannot do is take them.
 */
export async function claimNextTask(
  agentId: string,
  filters: NextTaskFilters = {},
): Promise<ClaimResult | null> {
  // Anything whose holder has gone quiet is fair game again before we look.
  await releaseExpiredLeases();

  const sqlClient = getSql();
  const includeUnassigned = filters.includeUnassigned ?? true;

  const rows = await sqlClient<ClaimedRow[]>`
    with candidate as (
      select id
      from tasks
      where status in ('backlog', 'todo')
        -- A "suggest_only" task is never taken: that autonomy means the agent
        -- reads, comments and proposes. Filtering here rather than claiming and
        -- rolling back keeps the gate in one place and the lease honest.
        and autonomy <> 'suggest_only'
        and (claimed_by_agent_id is null or lease_expires_at < now())
        and (
          (assignee_type = 'agent' and assignee_id = ${agentId}::uuid)
          ${includeUnassigned ? sqlClient`or assignee_id is null` : sqlClient``}
        )
        ${filters.projectId ? sqlClient`and project_id = ${filters.projectId}::uuid` : sqlClient``}
      order by
        case priority
          when 'urgent' then 0 when 'high' then 1 when 'normal' then 2
          when 'low' then 3 else 4
        end,
        due_date asc nulls last,
        sort_order asc,
        created_at asc
      limit 1
      for update skip locked
    )
    update tasks set
      claimed_by_agent_id = ${agentId}::uuid,
      claim_id            = gen_random_uuid(),
      lease_expires_at    = now() + make_interval(secs => ${leaseTtlSeconds()}),
      heartbeat_at        = now(),
      claim_count         = tasks.claim_count + 1,
      assignee_type       = 'agent',
      assignee_id         = ${agentId}::uuid,
      status              = 'in_progress',
      updated_at          = now()
    from candidate
    where tasks.id = candidate.id
    returning tasks.id, tasks.title, tasks.claim_id, tasks.claimed_by_agent_id,
              tasks.lease_expires_at, null::uuid as previous_agent_id
  `;

  const row = rows[0];
  if (!row) return null;

  return buildSuccess(row, false);
}

/**
 * Pushes the lease out, as a side effect of the agent doing its job.
 *
 * Deliberately refuses a lapsed lease instead of quietly reviving it: once the
 * deadline has passed the task is back in the queue, and a late runner has to
 * claim it again rather than assume it is still the owner.
 */
export async function renewLease(
  taskId: string,
  agentId: string,
  claimId?: string | null,
): Promise<boolean> {
  const rows = await db
    .update(tasks)
    .set({ leaseExpiresAt: leaseExpiry(), heartbeatAt: sql`now()` })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.claimedByAgentId, agentId),
        sql`${tasks.leaseExpiresAt} > now()`,
        claimId ? eq(tasks.claimId, claimId) : sql`true`,
      ),
    )
    .returning({ id: tasks.id });

  return rows.length > 0;
}

/** Drops the lease on purpose — when the agent closes or gives up a task. */
export async function releaseLease(taskId: string, agentId: string): Promise<void> {
  await db
    .update(tasks)
    .set({ claimedByAgentId: null, claimId: null, leaseExpiresAt: null })
    .where(and(eq(tasks.id, taskId), eq(tasks.claimedByAgentId, agentId)));
}

export type ReleasedLease = { taskId: string; title: string; agentId: string | null };

type ReleasedRow = { id: string; title: string; former_agent_id: string | null };

/**
 * Puts tasks whose holder went quiet back in the queue.
 *
 * Called at the head of the queue reads, on every runner pass and when the
 * approvals inbox loads, which is enough: there is no scheduler in this app
 * and adding a container for a sweep this cheap would be a container for
 * nothing. The partial index on `lease_expires_at` keeps it to an index scan
 * over the few leased rows.
 *
 * `skip locked` matters here too: a sweep must never block an agent that is
 * mid-renewal, and a row that is being renewed right now is one this pass has
 * no business reclaiming.
 */
export async function releaseExpiredLeases(): Promise<ReleasedLease[]> {
  const sqlClient = getSql();

  const rows = await sqlClient<ReleasedRow[]>`
    with expired as (
      select id, claimed_by_agent_id
      from tasks
      where claimed_by_agent_id is not null
        and lease_expires_at is not null
        and lease_expires_at < now()
      for update skip locked
    )
    update tasks set
      claimed_by_agent_id = null,
      claim_id            = null,
      lease_expires_at    = null,
      status              = ${RECLAIM_STATUS}::task_status,
      updated_at          = now()
    from expired
    where tasks.id = expired.id
    returning tasks.id, tasks.title, expired.claimed_by_agent_id as former_agent_id
  `;

  const released: ReleasedLease[] = rows.map((row) => ({
    taskId: row.id,
    title: row.title,
    agentId: row.former_agent_id,
  }));

  for (const entry of released) {
    await logActivity({
      actor: { type: 'system', name: 'system' },
      action: 'task.lease_expired',
      entityType: 'task',
      entityId: entry.taskId,
      meta: { title: entry.title, agentId: entry.agentId, backTo: RECLAIM_STATUS },
    });
    emitEvent('task.changed', { id: entry.taskId, action: 'updated' });
  }

  return released;
}
