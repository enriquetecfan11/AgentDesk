import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { tokenDisplayPrefix } from '@/lib/agent-token';
import { hashAgentToken } from '@/lib/auth/agent';
import { OPEN_DELEGATION_STATUSES, type AgentStatusValue } from '@/lib/constants';
import { db } from '@/lib/db/client';
import { agents, apiTokens, delegations, runs } from '@/lib/db/schema';
import { purgeRunFiles } from '@/lib/domain/runs';
import { serializeAgent, serializeToken } from '@/lib/domain/serialize';
import type { AgentDTO, ApiTokenCreatedDTO, ApiTokenDTO } from '@/lib/types';
import type { AgentCreateInput, AgentUpdateInput, TokenCreateInput } from '@/lib/validation';

export type AgentFilters = {
  includeArchived?: boolean;
  status?: AgentStatusValue;
};

/** Agents, each with the counters the list needs. Aggregates are merged in memory. */
export async function listAgents(filters: AgentFilters = {}): Promise<AgentDTO[]> {
  const conditions = [];
  if (!filters.includeArchived) conditions.push(sql`${agents.status} <> 'archived'`);
  if (filters.status) conditions.push(eq(agents.status, filters.status));

  const rows = await db
    .select()
    .from(agents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(agents.name));

  if (rows.length === 0) return [];

  const [tokenRows, delegationRows, runRows] = await Promise.all([
    db
      .select({ agentId: apiTokens.agentId, value: sql<number>`count(*)`.mapWith(Number) })
      .from(apiTokens)
      .where(isNull(apiTokens.revokedAt))
      .groupBy(apiTokens.agentId),
    db
      .select({ agentId: delegations.toAgentId, value: sql<number>`count(*)`.mapWith(Number) })
      .from(delegations)
      .where(inArray(delegations.status, OPEN_DELEGATION_STATUSES))
      .groupBy(delegations.toAgentId),
    db
      .select({
        agentId: runs.agentId,
        active: sql<number>`count(*) filter (where ${runs.status} in ('queued', 'running'))`.mapWith(
          Number,
        ),
        lastRunAt: sql<Date | null>`max(${runs.createdAt})`,
      })
      .from(runs)
      .groupBy(runs.agentId),
  ]);

  const tokenCount = new Map(tokenRows.map((row) => [row.agentId, row.value]));
  const delegationCount = new Map(delegationRows.map((row) => [row.agentId, row.value]));
  const runStats = new Map(
    runRows.map((row) => [row.agentId, { active: row.active, lastRunAt: row.lastRunAt }]),
  );

  return rows.map((agent) =>
    serializeAgent(agent, {
      tokenCount: tokenCount.get(agent.id) ?? 0,
      openDelegations: delegationCount.get(agent.id) ?? 0,
      activeRuns: runStats.get(agent.id)?.active ?? 0,
      lastRunAt: runStats.get(agent.id)?.lastRunAt ?? null,
    }),
  );
}

export async function getAgent(id: string): Promise<AgentDTO | null> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (!row) return null;

  const [tokenCount, openDelegations, runStats] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(apiTokens)
      .where(and(eq(apiTokens.agentId, id), isNull(apiTokens.revokedAt))),
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(delegations)
      .where(
        and(eq(delegations.toAgentId, id), inArray(delegations.status, OPEN_DELEGATION_STATUSES)),
      ),
    db
      .select({
        active: sql<number>`count(*) filter (where ${runs.status} in ('queued', 'running'))`.mapWith(
          Number,
        ),
        lastRunAt: sql<Date | null>`max(${runs.createdAt})`,
      })
      .from(runs)
      .where(eq(runs.agentId, id)),
  ]);

  return serializeAgent(row, {
    tokenCount: tokenCount[0]?.value ?? 0,
    openDelegations: openDelegations[0]?.value ?? 0,
    activeRuns: runStats[0]?.active ?? 0,
    lastRunAt: runStats[0]?.lastRunAt ?? null,
  });
}

export async function createAgent(input: AgentCreateInput): Promise<AgentDTO> {
  const [row] = await db
    .insert(agents)
    .values({
      name: input.name,
      description: input.description ?? null,
      capabilities: input.capabilities ?? [],
      status: input.status,
    })
    .returning();

  return (await getAgent(row.id))!;
}

export async function updateAgent(id: string, input: AgentUpdateInput): Promise<AgentDTO | null> {
  const patch: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.capabilities !== undefined) patch.capabilities = input.capabilities;
  if (input.status !== undefined) patch.status = input.status;

  const [row] = await db.update(agents).set(patch).where(eq(agents.id, id)).returning();
  if (!row) return null;

  return getAgent(id);
}

/**
 * Deletes an agent with everything hanging off it.
 *
 * Tokens, delegations and runs go away through the foreign key cascade, but the
 * files a run produced live on the uploads volume: they are removed first,
 * while the rows that point at them still exist.
 */
export async function deleteAgent(id: string): Promise<boolean> {
  const agentRuns = await db.select({ id: runs.id }).from(runs).where(eq(runs.agentId, id));
  await purgeRunFiles(agentRuns.map((run) => run.id));

  const rows = await db.delete(agents).where(eq(agents.id, id)).returning({ id: agents.id });
  return rows.length > 0;
}

export async function getAgentRef(id: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export async function listTokens(agentId: string): Promise<ApiTokenDTO[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.agentId, agentId))
    .orderBy(desc(apiTokens.createdAt));

  return rows.map(serializeToken);
}

export async function getToken(id: string): Promise<ApiTokenDTO | null> {
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
  return row ? serializeToken(row) : null;
}

export class AgentNotFoundError extends Error {
  constructor() {
    super('Agente no encontrado');
    this.name = 'AgentNotFoundError';
  }
}

/**
 * Issues a credential.
 *
 * The raw value exists only in the returned object: the database keeps its
 * SHA-256 and a short display prefix. There is no "show it again" endpoint, by
 * design — a lost token is replaced, not recovered.
 */
export async function createToken(
  agentId: string,
  input: TokenCreateInput,
): Promise<ApiTokenCreatedDTO> {
  const agent = await getAgentRef(agentId);
  if (!agent) throw new AgentNotFoundError();

  const secret = `agt_${randomBytes(32).toString('base64url')}`;

  const [row] = await db
    .insert(apiTokens)
    .values({
      agentId,
      name: input.name,
      tokenPrefix: tokenDisplayPrefix(secret),
      tokenHash: hashAgentToken(secret),
      scopes: input.scopes,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    })
    .returning();

  return { token: serializeToken(row), secret };
}

export async function revokeToken(id: string): Promise<ApiTokenDTO | null> {
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning();

  return row ? serializeToken(row) : null;
}

/** Revoked tokens are not deleted: the audit trail of a token stays readable. */
export async function deleteToken(id: string): Promise<boolean> {
  const rows = await db.delete(apiTokens).where(eq(apiTokens.id, id)).returning({ id: apiTokens.id });
  return rows.length > 0;
}
