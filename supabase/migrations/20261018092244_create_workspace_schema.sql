/*
# Create operational workspace schema (single-tenant, no auth)

1. Purpose
- Core schema for a personal operational workspace shared by a human, AI agents and n8n automations.
- Single-tenant by design: one workspace owner, no sign-in in v1. The browser uses the anon key,
  and agent/automation clients authenticate with per-agent tokens validated by Edge Functions
  using the service role.

2. New Tables
- `actors` — unified identity for anyone acting in the system (human / agent / automation).
  Fields: id, kind, name, display_name, color, status, meta (jsonb), created_at, updated_at.
  The singleton human actor (kind = 'human') is seeded on first insert.
- `agents` — configuration of an AI agent: capabilities, execution tool, per-agent permissions
  (jsonb), plaintext-once token shown at creation plus token hash for validation.
  Fields: id, name, description, kind (organizer/executor/analyst), tool, capabilities (jsonb),
  permissions (jsonb), token_hash, token_prefix, status, created_at, updated_at.
  One-to-one with an actors row (actor_id).
- `automations` — registered external workflows (n8n): permissions (jsonb), optional output
  webhook URL, secret hash + prefix for webhook validation, status.
  One-to-one with an actors row (actor_id).
- `projects` — container of work. Fields: id, name, description, status (active/paused/archived),
  color, sort_order, archived_at, created_at, updated_at.
- `tasks` — unit of work. Fields: id, title, description, status (backlog/in_progress/review/done),
  priority (urgent/high/normal/low), due_date, completed_at, project_id (nullable),
  parent_task_id (nullable, subtrees), assignee_id (nullable, references actors),
  origin (human/agent/automation), sort_order, created_at, updated_at.
- `notes` — lightweight markdown work notes. Fields: id, title, body_md, project_id (nullable),
  task_id (nullable), source (app/obsidian), vault_path (unique, nullable), created_at, updated_at.
- `delegations` — contract human->agent over a task: brief, limits, completion_criteria,
  status (pending/in_progress/completed/failed/cancelled). References task and agent.
- `delegation_context` — context references attached to a delegation. Fields: id, delegation_id,
  kind (note/artifact/url/decision), ref_id (nullable), url (nullable), description.
- `runs` — one concrete execution of a delegation. Fields: id, delegation_id, agent_id,
  status (started/running/succeeded/failed), input (jsonb snapshot), summary, error, started_at,
  finished_at, duration_ms, created_at.
- `artifacts` — results produced by a run. Fields: id, run_id (nullable), task_id (nullable),
  project_id (nullable), kind (text/code/url/file), title, content_text, storage_path, url,
  created_at.
- `decisions` — registered decisions. Fields: id, project_id (nullable), task_id (nullable),
  title, what, why, decided_by (nullable, actor), alternatives (jsonb), decided_at, created_at.
- `automations_log` — history of n8n webhook invocations. Fields: id, automation_id, action,
  payload (jsonb), result (jsonb), created_at.
- `events` — append-only audit trail (no UPDATE/DELETE privileges granted to anyone).
  Fields: id, kind, actor_id (nullable), entity_type, entity_id, entity_title, payload (jsonb),
  created_at.

3. Security
- RLS enabled on every table.
- Single-tenant, no sign-in: anon-key CRUD allowed via `TO anon, authenticated` policies
  (SELECT/INSERT/UPDATE/DELETE, 4 separate policies per table) — data is intentionally
  workspace-public to this single installation. This is documented per skill guidance.
- Events are append-only: only SELECT and INSERT policies exist, and UPDATE/DELETE are not
  granted to anon/authenticated anywhere.
- Agent tokens are stored hashed (sha256) and never exposed to the browser; token validation
  happens only in Edge Functions with the service role.

4. Important notes
- Delegation status changes are managed by the API layer; a trigger on `runs` auto-updates the
  parent delegation status (first run -> in_progress, success -> completed, failure -> failed).
- `set_updated_at()` trigger function keeps updated_at columns current on tasks/projects/notes/
  agents/automations.
- Realtime is enabled for tasks, runs, delegations and events so the UI updates live when
  agents or n8n change data.
*/

-- Extension for case-insensitive text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Helper: keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============ actors ============
CREATE TABLE IF NOT EXISTS public.actors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('human','agent','automation')),
  name text NOT NULL,
  display_name text,
  color text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS actors_updated_at ON public.actors;
CREATE TRIGGER actors_updated_at BEFORE UPDATE ON public.actors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed singleton human actor exactly once
INSERT INTO public.actors (kind, name, display_name, color)
SELECT 'human', 'Yo', 'Yo', '#22c55e'
WHERE NOT EXISTS (SELECT 1 FROM public.actors WHERE kind = 'human');

-- ============ projects ============
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  color text NOT NULL DEFAULT '#3b82f6',
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS projects_updated_at ON public.projects;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ tasks ============
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','in_progress','review','done')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','high','normal','low')),
  due_date date,
  completed_at timestamptz,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  parent_task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  assignee_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  origin text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','agent','automation')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tasks_updated_at ON public.tasks;
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON public.tasks (project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON public.tasks (assignee_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON public.tasks (status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks (parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm ON public.tasks USING gin (title gin_trgm_ops);

-- ============ agents ============
CREATE TABLE IF NOT EXISTS public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'executor' CHECK (kind IN ('organizer','executor','analyst')),
  tool text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  permissions jsonb NOT NULL DEFAULT '["read_delegations","write_runs","write_artifacts"]'::jsonb,
  token_hash text,
  token_prefix text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS agents_updated_at ON public.agents;
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ automations ============
CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  permissions jsonb NOT NULL DEFAULT '["create_task","update_task"]'::jsonb,
  output_webhook_url text,
  secret_hash text,
  secret_prefix text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS automations_updated_at ON public.automations;
CREATE TRIGGER automations_updated_at BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ notes ============
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body_md text NOT NULL DEFAULT '',
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','obsidian')),
  vault_path text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS notes_updated_at ON public.notes;
CREATE TRIGGER notes_updated_at BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_notes_project ON public.notes (project_id);
CREATE INDEX IF NOT EXISTS idx_notes_task ON public.notes (task_id);

-- ============ delegations ============
CREATE TABLE IF NOT EXISTS public.delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  brief text NOT NULL,
  limits text,
  completion_criteria text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS delegations_updated_at ON public.delegations;
CREATE TRIGGER delegations_updated_at BEFORE UPDATE ON public.delegations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_delegations_agent_status ON public.delegations (agent_id, status);
CREATE INDEX IF NOT EXISTS idx_delegations_task ON public.delegations (task_id);

-- ============ delegation_context ============
CREATE TABLE IF NOT EXISTS public.delegation_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id uuid NOT NULL REFERENCES public.delegations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('note','artifact','url','decision')),
  ref_id uuid,
  url text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delegation_context_delegation ON public.delegation_context (delegation_id);

-- ============ runs ============
CREATE TABLE IF NOT EXISTS public.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegation_id uuid NOT NULL REFERENCES public.delegations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','running','succeeded','failed')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_delegation ON public.runs (delegation_id);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON public.runs (agent_id, status);

-- Auto-update delegation status from run lifecycle
CREATE OR REPLACE FUNCTION public.on_run_status_change() RETURNS trigger AS $$
DECLARE
  d uuid;
  new_d_status text;
BEGIN
  d := NEW.delegation_id;
  IF NEW.status IN ('started','running') THEN
    new_d_status := 'in_progress';
  ELSIF NEW.status = 'succeeded' THEN
    new_d_status := 'completed';
  ELSIF NEW.status = 'failed' THEN
    new_d_status := 'failed';
  ELSE
    RETURN NEW;
  END IF;

  UPDATE public.delegations
    SET status = new_d_status
    WHERE id = d
      AND status NOT IN ('completed','cancelled');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS runs_status_trigger ON public.runs;
CREATE TRIGGER runs_status_trigger AFTER INSERT OR UPDATE OF status ON public.runs
  FOR EACH ROW EXECUTE FUNCTION public.on_run_status_change();

-- ============ artifacts ============
CREATE TABLE IF NOT EXISTS public.artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.runs(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','code','url','file')),
  title text NOT NULL,
  content_text text,
  storage_path text,
  url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON public.artifacts (run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON public.artifacts (task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON public.artifacts (project_id);

-- ============ decisions ============
CREATE TABLE IF NOT EXISTS public.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  title text NOT NULL,
  what text NOT NULL,
  why text,
  decided_by uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decisions_project ON public.decisions (project_id);

-- ============ automations_log ============
CREATE TABLE IF NOT EXISTS public.automations_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid REFERENCES public.automations(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_log_automation ON public.automations_log (automation_id, created_at DESC);

-- ============ events (append-only audit trail) ============
CREATE TABLE IF NOT EXISTS public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  actor_id uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_title text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_entity ON public.events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_actor ON public.events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_kind ON public.events (kind, created_at DESC);

-- ============ RLS: enable on all tables ============
ALTER TABLE public.actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delegation_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- ============ RLS policies: single-tenant workspace, no sign-in ============
-- The app has no sign-in in v1: the browser operates with the anon key. Data is intentionally
-- workspace-scoped to this single installation, so policies TO anon, authenticated with
-- USING(true)/WITH CHECK(true) are the documented, correct choice here. The `events` table is
-- append-only (SELECT + INSERT only) and its UPDATE/DELETE are never granted.
DO $$
DECLARE
  t text;
  tables_all text[] := ARRAY[
    'actors','projects','tasks','agents','automations','notes','delegations',
    'delegation_context','runs','artifacts','decisions','automations_log','events'
  ];
BEGIN
  FOREACH t IN ARRAY tables_all LOOP
    EXECUTE format('DROP POLICY IF EXISTS "workspace_select" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "workspace_insert" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "workspace_update" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "workspace_delete" ON public.%I', t);

    EXECUTE format('CREATE POLICY "workspace_select" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t);
    EXECUTE format('CREATE POLICY "workspace_insert" ON public.%I FOR INSERT TO anon, authenticated WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "workspace_update" ON public.%I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)', t);
    EXECUTE format('CREATE POLICY "workspace_delete" ON public.%I FOR DELETE TO anon, authenticated USING (true)', t);
  END LOOP;
END;
$$;

-- Events must be append-only: remove update/delete policies if they exist
DROP POLICY IF EXISTS "workspace_update" ON public.events;
DROP POLICY IF EXISTS "workspace_delete" ON public.events;

-- ============ Realtime ============
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.delegations;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
REVOKE UPDATE, DELETE ON public.events FROM anon, authenticated;
