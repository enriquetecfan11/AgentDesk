# Operative — deployment

Next.js frontend on Vercel, database and Edge Functions on Supabase.

## Prerequisites

- Node 20 LTS (the app builds on newer versions too, but 20 is what CI should pin)
- A Supabase project
- A Vercel account
- The [Supabase CLI](https://supabase.com/docs/guides/cli) for migrations and functions

```bash
npm install
npm install -g supabase
```

## Environment variables

Copy `.env.example` to `.env.local` and fill it in. The three variables below are the only
ones the app and the Edge Functions need.

| Variable | Scope | Required by | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | browser bundle | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | browser bundle | The anon key. Safe to expose; RLS is the control. |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | `app/api/**` only | Bypasses RLS. Never expose it. |

Anything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle. Never put a secret in
a `NEXT_PUBLIC_` name.

`SUPABASE_SERVICE_ROLE_KEY` is read only by the four route handlers in `app/api/agents/**`
and `app/api/automations/**`. `lib/agents-server.ts` declares `import 'server-only'`, so the
build fails loudly if that module is ever pulled into a client component.

The `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` entries in
`.env.example` are for the Supabase CLI only. The CLI reads them from your shell or from
`.env.local`; they are not needed by Vercel.

Generate the service role key from the CLI:

```bash
supabase projects api-keys --project-ref <project-ref>
```

## Database

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

`supabase db push` applies every migration in `supabase/migrations/` that is not yet on the
remote database, in filename order. There are four:

| Migration | Purpose |
|---|---|
| `20261018092244_create_workspace_schema.sql` | 13 tables, indexes, RLS enabled, realtime |
| `20261018094500_harden_functions_search_path.sql` | Pins `search_path` on the trigger functions |
| `20261018120000_restrict_anon_privileges.sql` | Removes anon write access to `agents` / `automations`, protects the credential hashes |
| `20261018120100_index_credential_lookup.sql` | Indexes `token_hash` and `secret_hash` |

Apply them before the first deploy. The Edge Functions authenticate against
`agents.token_hash`, so the app is non-functional until `db push` has run.

Verify remotely without touching it:

```bash
supabase db diff --linked --schema public
```

## Edge Functions

```bash
supabase functions deploy agent-api
supabase functions deploy mcp-gateway
supabase functions deploy n8n-ingest
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform automatically.
Nothing else is needed in their environment.

All three functions have `verify_jwt = false` in `supabase/config.toml`. That is deliberate:
they authenticate with per-agent bearer tokens (`Authorization: Bearer agt_...` for
`agent-api` and `mcp-gateway`, `X-N8N-Secret` for `n8n-ingest`) rather than with Supabase
Auth. Do not "fix" this by turning `verify_jwt` on without also adding a real auth scheme.

### Checking the functions

```bash
# identity, with an agent token
curl https://<ref>.supabase.co/functions/v1/agent-api \
  -H "Authorization: Bearer agt_..."

# MCP initialize
curl https://<ref>.supabase.co/functions/v1/mcp-gateway \
  -H "Authorization: Bearer agt_..." \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

### Type checking the functions

`tsconfig.json` excludes `supabase/functions`, because the Edge Functions run on Deno and
`tsc` does not know the `Deno` global. `npm run typecheck` therefore does **not** cover
them. Check them with Deno instead:

```bash
deno check supabase/functions/agent-api/index.ts
deno check supabase/functions/mcp-gateway/index.ts
deno check supabase/functions/n8n-ingest/index.ts
```

All three pass. Note that two latent type errors in the Edge Functions were only ever
visible this way; keep running these checks after touching them.

## Vercel

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Framework preset: **Next.js**. Build command `npm run build`, output `.next` — all
   defaults, nothing to override.
3. Add the three environment variables under **Settings → Environment Variables**, for all
   three environments (Production, Preview, Development).
4. Deploy.

There is no `vercel.json` and none is needed. The app is a standard App Router project with
no rewrites, no middleware and no custom headers.

`npm run lint` is no longer skipped during builds, so a lint error will fail the deployment.
`npm run build` and `npm run lint` both pass on a clean checkout.

## Supabase Auth redirect URLs

The app has no sign-in, so nothing in it needs a redirect today. Configure these anyway under
**Authentication → URL Configuration** before you add auth, otherwise a future login flow
will silently fail:

- **Site URL**: `https://<your-domain>.vercel.app`
- **Redirect URLs**: `https://<your-domain>.vercel.app/**`

Avoid wildcards in production. List explicit paths, for example
`https://<your-domain>.vercel.app/auth/callback`.

## Security model

Read this before exposing the deployment publicly.

### What is protected

- Agent tokens and n8n secrets are generated with `crypto.getRandomValues` (192 and 160 bits
  of entropy), stored **only** as a sha256 hash, and returned to the UI exactly once at
  creation. There is no endpoint that can read a token back.
- `agents` and `automations` are not writable by the `anon` role, and `token_hash` /
  `secret_hash` are not readable by it either. An attacker holding only the browser's anon
  key cannot forge an agent credential.
- Agent credentials are scoped per agent: a task is only visible to an agent that has been
  delegated it, and `run_id` references must belong to that agent's own runs.
- Every Edge Function validates its input, length-caps free text, and returns opaque errors
  rather than database messages.

### What is NOT protected — residual risk

**The anon key still grants full read and write access to all business data.** There is no
sign-in. `tasks`, `projects`, `notes`, `delegations`, `runs`, `artifacts`, `decisions`,
`actors` and `automations_log` all keep `USING (true)` policies for the `anon` role, and
`events` can be inserted.

The anon key is public: it ships in the browser bundle. Anyone who obtains it can read the
entire workspace, delete every task and project, and write false entries into the timeline.
The credential forgery path that existed before migration `20261018120000` is closed, but
data integrity and confidentiality are not.

This is acceptable for a private deployment. It is **not** acceptable for a public URL.
Two mitigations, in increasing order of effort:

1. Keep the deployment private. On Vercel, enable **Deployment Protection** under Settings →
   Protection so only your team can load the app. This does not fix the anon key, but it
   means nobody else can reach the page to extract it.
2. Add Supabase Auth and scope the RLS policies to `auth.uid()`. This is the only change
   that actually closes the gap. The policy loop in
   `20261018092244_create_workspace_schema.sql` is the place to do it, and
   `lib/supabase.ts` is where the client would start persisting a session.

### Known outstanding issue: Next.js is out of date

`next` is pinned at `13.5.1` and `npm audit` reports **33 advisories against it, including
two unauthenticated remote code execution CVEs**, with no automatic fix available — the
upgrade target is past 15.5.23.

Most of those advisories target features this app does not use, which reduces the practical
exposure but does not eliminate it:

| Advisory class | Applies here? |
|---|---|
| Image Optimization RCE / cache issues | No — there is no `next/image` usage anywhere |
| Middleware authorization bypass | No — there is no `middleware.ts` |
| Server Actions SSRF / DoS | No — the app uses Route Handlers, not Server Actions |
| Rewrites request smuggling / SSRF | No — no rewrites are configured |
| Unauthenticated RCE on Windows hosts | No — deploying to Vercel, which is Linux |
| Cache poisoning / response cache confusion | **Partly** — applies to App Router responses generally |

Upgrading Next 13 → 15 is a major migration, not a version bump: React 18 → 19, async
request APIs, and a new ESLint major. It was left out of this pass deliberately, because it
is a framework upgrade rather than a deployment fix. Treat it as the next piece of work
before this app faces the public internet.

## Routine commands

```bash
npm run dev            # local dev server
npm run build          # production build
npm run lint           # eslint (now enforced during build)
npm run typecheck      # tsc --noEmit; does not cover supabase/functions
```