import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq, gt, isNull, or } from 'drizzle-orm';

import {
  hasScope,
  looksLikeAgentToken,
  parseBearerToken,
  type AgentScope,
} from '@/lib/agent-token';
import { db } from '@/lib/db/client';
import { agents, apiTokens } from '@/lib/db/schema';
import { HttpError } from '@/lib/api/http';

export type AgentActor = {
  agentId: string;
  agentName: string;
  agentStatus: 'active' | 'paused' | 'archived';
  tokenId: string;
  scopes: string[];
};

/**
 * Only the SHA-256 of the token is stored.
 *
 * The token already carries 256 bits of randomness, so a plain hash is enough:
 * there is nothing to brute force, and hashing without a salt keeps the lookup
 * a single indexed query.
 */
export function hashAgentToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Resolves a token to the agent behind it.
 *
 * Returns null for anything that is not a live credential. `lastUsedAt` is
 * touched here rather than in each endpoint, so the UI always shows when a
 * token was last seen.
 */
export async function resolveAgentToken(raw: string): Promise<AgentActor | null> {
  if (!looksLikeAgentToken(raw)) return null;

  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      scopes: apiTokens.scopes,
      agentId: agents.id,
      agentName: agents.name,
      agentStatus: agents.status,
    })
    .from(apiTokens)
    .innerJoin(agents, eq(agents.id, apiTokens.agentId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashAgentToken(raw)),
        isNull(apiTokens.revokedAt),
        // `expiresAt IS NULL` means "never expires".
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!row) return null;

  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.tokenId));

  return {
    agentId: row.agentId,
    agentName: row.agentName,
    agentStatus: row.agentStatus,
    tokenId: row.tokenId,
    scopes: row.scopes ?? [],
  };
}

/**
 * Authenticates an agent request.
 *
 * `scope` is optional: an endpoint that only needs a valid identity (like
 * `/api/v1/me`) still gets the actor.
 */
export async function requireAgent(request: Request, scope?: AgentScope): Promise<AgentActor> {
  const raw = parseBearerToken(request.headers.get('authorization'));
  if (!raw) {
    throw new HttpError(401, 'Falta el token de agente (Authorization: Bearer …)');
  }

  const actor = await resolveAgentToken(raw);
  if (!actor) throw new HttpError(401, 'Token no válido, revocado o caducado');

  if (actor.agentStatus === 'archived') {
    throw new HttpError(403, 'El agente está archivado');
  }

  if (scope && !hasScope(actor.scopes, scope)) {
    throw new HttpError(403, `El token no tiene el scope ${scope}`);
  }

  return actor;
}

/** Who performed an action, for the activity log. */
export function agentActivityActor(actor: AgentActor) {
  return { type: 'agent' as const, id: actor.agentId, name: actor.agentName };
}
