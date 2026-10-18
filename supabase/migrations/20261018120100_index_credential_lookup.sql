/*
# Index credential lookup columns

Every authenticated Edge Function call resolves a bearer credential by matching
a sha256 hash:

    select ... from agents where token_hash = $1
    select ... from automations where secret_hash = $1

Both columns are unindexed, so each of those lookups is a sequential scan of
the table. Small today, but it is a full scan on the hot path of every single
agent / n8n request and it grows linearly with the number of agents.

These are unique in practice: each token is 192 bits (agents) or 160 bits
(automations) of crypto.getRandomValues, so collisions do not occur. A unique
index makes that guarantee explicit and gives the auth lookup an index scan.

Partial indexes keep them small: paused agents and paused automations are never
accepted by authenticate(), so they need not be reachable through the index.
*/

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_token_hash
  ON public.agents (token_hash)
  WHERE token_hash IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_automations_secret_hash
  ON public.automations (secret_hash)
  WHERE secret_hash IS NOT NULL AND status = 'active';