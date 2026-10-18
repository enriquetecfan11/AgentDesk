/*
# Restrict anonymous access to agent and automation credentials

1. Problem
- The base migration grants the browser `anon` role full CRUD on every table via
  `USING (true)` / `WITH CHECK (true)` policies. That is intentional for a
  single-tenant workspace, but `agents` and `automations` are the tables that
  hold credentials, and leaving them writable by `anon` allows a complete
  privilege escalation:

    1. read  `agents.token_hash`          with the public anon key
    2. write `agents.token_hash` to the sha256 of an attacker-chosen token
    3. call the `agent-api` / `mcp-gateway` Edge Functions with that token

  The Edge Functions authenticate by looking the hash up, so step 3 fully
  impersonates the agent, service-role and all.

2. Fix
- Revoke INSERT/UPDATE/DELETE on `agents` and `automations` from `anon` and
  `authenticated`. The browser no longer mutates credential-bearing rows; the
  privileged writes go through the Next.js Route Handlers in `app/api/**`,
  which hold the service role key on the server.
- Revoke SELECT on the hash columns specifically. The UI still needs to LIST
  agents and automations, but it never needs the hashes, and a column-level
  revoke guarantees they are unreachable even if a query asks for `*`.
- The plain token/secret is still generated server-side, returned exactly once
  to the caller of the creation route, and only its sha256 is persisted.
  Hashing is unchanged: 192 bits of `crypto.getRandomValues` for agent tokens
  and 160 bits for n8n secrets, so a fast unsalted sha256 is safe here.
- `token_prefix` / `secret_prefix` stay readable on purpose: they are what the
  UI displays to identify a credential without disclosing it.

3. Unchanged on purpose
- `tasks`, `projects`, `notes`, `delegations`, `runs`, `artifacts`, `decisions`,
  `actors` and `automations_log` keep anonymous CRUD. This deployment has no
  sign-in, so the anon key remains a full read/write credential for business
  data. See the residual risk section of README.md; adding Supabase Auth is the
  only way to close it.
- Edge Functions are unaffected: `service_role` bypasses RLS entirely.

4. Idempotency
- Safe to re-run: DROP POLICY IF EXISTS, and REVOKE on a non-held privilege is
  a no-op rather than an error.
*/

-- ============ agents: credentials are write-protected, hashes unreadable ============

DROP POLICY IF EXISTS "workspace_insert" ON public.agents;
DROP POLICY IF EXISTS "workspace_update" ON public.agents;
DROP POLICY IF EXISTS "workspace_delete" ON public.agents;

REVOKE INSERT, UPDATE, DELETE ON public.agents FROM anon, authenticated;
REVOKE SELECT (token_hash) ON public.agents FROM anon, authenticated;

-- ============ automations: same treatment for the n8n webhook secret ============

DROP POLICY IF EXISTS "workspace_insert" ON public.automations;
DROP POLICY IF EXISTS "workspace_update" ON public.automations;
DROP POLICY IF EXISTS "workspace_delete" ON public.automations;

REVOKE INSERT, UPDATE, DELETE ON public.automations FROM anon, authenticated;
REVOKE SELECT (secret_hash) ON public.automations FROM anon, authenticated;

-- Belt and braces: confirm the hashes are still reachable with the service role,
-- which is what the Edge Functions rely on.
DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.agents', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost SELECT on public.agents';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.automations', 'SELECT') THEN
    RAISE EXCEPTION 'service_role lost SELECT on public.automations';
  END IF;
  IF has_column_privilege('anon', 'public.agents', 'token_hash', 'SELECT') THEN
    RAISE EXCEPTION 'anon can still read public.agents.token_hash';
  END IF;
  IF has_column_privilege('anon', 'public.automations', 'secret_hash', 'SELECT') THEN
    RAISE EXCEPTION 'anon can still read public.automations.secret_hash';
  END IF;
END;
$$;