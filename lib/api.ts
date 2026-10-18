import {
  createAgentWithActor, createAutomationWithSecret, deleteAgentWithActor, updateAgentConfig,
} from '@/lib/agents-server';
import { supabase } from './supabase';
import type {
  Actor, Agent, AgentKind, AgentWithActor, Artifact, Automation, Delegation, DelegationWithContext,
  Decision, Note, Project, Run, Task, TaskWithRefs, WorkspaceEvent,
  TaskStatus, TaskPriority, DelegationStatus, RunStatus,
} from './types';

// ============ Actors ============

export async function getHumanActor(): Promise<Actor | null> {
  const { data, error } = await supabase
    .from('actors')
    .select('*')
    .eq('kind', 'human')
    .maybeSingle();
  if (error) throw error;
  return data as Actor | null;
}

export async function listAgents(): Promise<AgentWithActor[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('*, actor:actors(*)')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as unknown as AgentWithActor[];
}

export async function createAgent(input: {
  name: string; description: string | null; kind: AgentKind;
}): Promise<{ agent: AgentWithActor; token: string }> {
  const { agentId, token } = await createAgentWithActor(input);
  const { data, error } = await supabase
    .from('agents')
    .select('*, actor:actors(*)')
    .eq('id', agentId)
    .maybeSingle();
  if (error) throw error;
  return { agent: data as unknown as AgentWithActor, token };
}

export async function deleteAgent(agentId: string, actorId: string | null): Promise<void> {
  await deleteAgentWithActor(agentId, actorId);
}

export async function updateAgent(agentId: string, patch: {
  status?: 'active' | 'paused'; name?: string; description?: string | null;
}): Promise<void> {
  await updateAgentConfig(agentId, patch);
}

// ============ Projects ============

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .neq('status', 'archived')
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function createProject(input: {
  name: string; description?: string | null; color?: string | null;
}): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({ name: input.name, description: input.description ?? null, color: input.color ?? '#3b82f6' })
    .select('*')
    .single();
  if (error) throw error;
  await logEvent('project.created', 'project', (data as Project).id, (data as Project).name);
  return data as Project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) throw error;
  if (patch.status === 'archived') {
    await logEvent('project.archived', 'project', id, null);
  }
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ============ Tasks ============

const TASK_SELECT = '*, project:projects(*), assignee:actors(*)';

export async function listTasks(filter?: {
  status?: TaskStatus | TaskStatus[];
  projectId?: string;
  assigneeId?: string;
  origin?: string;
  dueFrom?: string;
  dueTo?: string;
  includeDone?: boolean;
  search?: string;
  inboxOnly?: boolean;
}): Promise<TaskWithRefs[]> {
  let q = supabase.from('tasks').select(TASK_SELECT).order('sort_order').order('created_at');
  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    q = q.in('status', statuses);
  }
  if (filter?.projectId) q = q.eq('project_id', filter.projectId);
  if (filter?.assigneeId) q = q.eq('assignee_id', filter.assigneeId);
  if (filter?.origin) q = q.eq('origin', filter.origin);
  if (filter?.dueFrom) q = q.gte('due_date', filter.dueFrom);
  if (filter?.dueTo) q = q.lte('due_date', filter.dueTo);
  if (filter?.search) q = q.ilike('title', `%${filter.search}%`);
  if (filter?.inboxOnly) q = q.is('project_id', null).eq('origin', 'human');
  if (!filter?.includeDone) q = q.neq('status', 'done');
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as TaskWithRefs[];
}

export async function createTask(input: {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  due_date?: string | null;
  project_id?: string | null;
  status?: TaskStatus;
  parent_task_id?: string | null;
  origin?: TaskPriority extends never ? never : 'human' | 'agent' | 'automation';
}): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      due_date: input.due_date ?? null,
      project_id: input.project_id ?? null,
      status: input.status ?? 'backlog',
      parent_task_id: input.parent_task_id ?? null,
      origin: input.origin ?? 'human',
    })
    .select('*')
    .single();
  if (error) throw error;
  await logEvent('task.created', 'task', (data as Task).id, input.title, { origin: input.origin ?? 'human' });
  return data as Task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<void> {
  if (patch.status === 'done' && !patch.completed_at) {
    (patch as Record<string, unknown>).completed_at = new Date().toISOString();
  }
  if (patch.status && patch.status !== 'done') {
    (patch as Record<string, unknown>).completed_at = null;
  }
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .select('title')
    .maybeSingle();
  if (error) throw error;
  if (patch.status) {
    await logEvent(`task.status_${patch.status}`, 'task', id, data?.title ?? null, { status: patch.status });
  } else if (patch.assignee_id !== undefined) {
    await logEvent('task.assigned', 'task', id, data?.title ?? null, { assignee_id: patch.assignee_id });
  }
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ============ Notes ============

export async function listNotes(filter?: { projectId?: string; taskId?: string }): Promise<Note[]> {
  let q = supabase.from('notes').select('*').order('updated_at', { ascending: false });
  if (filter?.projectId) q = q.eq('project_id', filter.projectId);
  if (filter?.taskId) q = q.eq('task_id', filter.taskId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Note[];
}

export async function createNote(input: {
  title: string; body_md?: string; project_id?: string | null; task_id?: string | null;
}): Promise<Note> {
  const { data, error } = await supabase
    .from('notes')
    .insert({
      title: input.title,
      body_md: input.body_md ?? '',
      project_id: input.project_id ?? null,
      task_id: input.task_id ?? null,
      source: 'app',
    })
    .select('*')
    .single();
  if (error) throw error;
  await logEvent('note.created', 'note', (data as Note).id, input.title);
  return data as Note;
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<void> {
  const { error } = await supabase.from('notes').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('notes').delete().eq('id', id);
  if (error) throw error;
}

// ============ Delegations ============

export async function listDelegations(filter?: {
  taskId?: string; agentId?: string; status?: DelegationStatus | DelegationStatus[];
}): Promise<DelegationWithContext[]> {
  let q = supabase
    .from('delegations')
    .select('*, agent:agents(*), context:delegation_context(*)')
    .order('created_at', { ascending: false });
  if (filter?.taskId) q = q.eq('task_id', filter.taskId);
  if (filter?.agentId) q = q.eq('agent_id', filter.agentId);
  if (filter?.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    q = q.in('status', statuses);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as DelegationWithContext[];
}

export async function createDelegation(input: {
  task_id: string;
  agent_id: string;
  brief: string;
  limits?: string | null;
  completion_criteria?: string | null;
  context?: { kind: 'note' | 'artifact' | 'url' | 'decision'; ref_id?: string | null; url?: string | null; description?: string | null }[];
}): Promise<Delegation> {
  const { data, error } = await supabase
    .from('delegations')
    .insert({
      task_id: input.task_id,
      agent_id: input.agent_id,
      brief: input.brief,
      limits: input.limits ?? null,
      completion_criteria: input.completion_criteria ?? null,
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw error;
  const delegation = data as Delegation;
  if (input.context?.length) {
    const rows = input.context.map((c) => ({
      delegation_id: delegation.id,
      kind: c.kind,
      ref_id: c.ref_id ?? null,
      url: c.url ?? null,
      description: c.description ?? null,
    }));
    const { error: ctxError } = await supabase.from('delegation_context').insert(rows);
    if (ctxError) throw ctxError;
  }
  await logEvent('delegation.created', 'delegation', delegation.id, input.brief.slice(0, 80), {
    task_id: input.task_id, agent_id: input.agent_id,
  });
  return delegation;
}

export async function updateDelegationStatus(id: string, status: DelegationStatus): Promise<void> {
  const { error } = await supabase.from('delegations').update({ status }).eq('id', id);
  if (error) throw error;
  await logEvent(`delegation.status_${status}`, 'delegation', id, null, { status });
}

// ============ Runs (browser-side read; agent writes go through the agent API) ============

export async function listRuns(filter?: { delegationId?: string; agentId?: string }): Promise<Run[]> {
  let q = supabase.from('runs').select('*').order('started_at', { ascending: false });
  if (filter?.delegationId) q = q.eq('delegation_id', filter.delegationId);
  if (filter?.agentId) q = q.eq('agent_id', filter.agentId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Run[];
}

export async function listArtifacts(filter?: { runId?: string; taskId?: string; projectId?: string }): Promise<Artifact[]> {
  let q = supabase.from('artifacts').select('*').order('created_at', { ascending: false });
  if (filter?.runId) q = q.eq('run_id', filter.runId);
  if (filter?.taskId) q = q.eq('task_id', filter.taskId);
  if (filter?.projectId) q = q.eq('project_id', filter.projectId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Artifact[];
}

// ============ Decisions ============

export async function listDecisions(filter?: { projectId?: string; taskId?: string }): Promise<Decision[]> {
  let q = supabase.from('decisions').select('*').order('decided_at', { ascending: false });
  if (filter?.projectId) q = q.eq('project_id', filter.projectId);
  if (filter?.taskId) q = q.eq('task_id', filter.taskId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Decision[];
}

export async function createDecision(input: {
  title: string; what: string; why?: string | null; project_id?: string | null; task_id?: string | null;
}): Promise<Decision> {
  const { data, error } = await supabase
    .from('decisions')
    .insert({
      title: input.title,
      what: input.what,
      why: input.why ?? null,
      project_id: input.project_id ?? null,
      task_id: input.task_id ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  await logEvent('decision.created', 'decision', (data as Decision).id, input.title);
  return data as Decision;
}

// ============ Automations ============

export async function listAutomations(): Promise<Automation[]> {
  const { data, error } = await supabase.from('automations').select('*').order('created_at');
  if (error) throw error;
  return (data ?? []) as Automation[];
}

export async function createAutomation(input: {
  name: string; description?: string | null; permissions?: string[];
}): Promise<{ automation: Automation; secret: string }> {
  const { automationId, secret } = await createAutomationWithSecret({
    name: input.name, description: input.description ?? null, permissions: input.permissions,
  });
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('id', automationId)
    .maybeSingle();
  if (error) throw error;
  return { automation: data as Automation, secret };
}

export async function updateAutomation(id: string, patch: Partial<Automation>): Promise<void> {
  const { error } = await supabase.from('automations').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteAutomation(id: string): Promise<void> {
  const { error } = await supabase.from('automations').delete().eq('id', id);
  if (error) throw error;
}

export async function listAutomationLog(filter?: { automationId?: string }): Promise<{
  id: string; automation_id: string; action: string; payload: Record<string, unknown>;
  result: Record<string, unknown>; created_at: string;
}[]> {
  let q = supabase.from('automations_log').select('*').order('created_at', { ascending: false }).limit(50);
  if (filter?.automationId) q = q.eq('automation_id', filter.automationId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ============ Events (timeline) ============

export async function listEvents(filter?: {
  entityType?: string; entityId?: string; actorId?: string; kind?: string; limit?: number;
}): Promise<WorkspaceEvent[]> {
  let q = supabase
    .from('events')
    .select('*, actor:actors(*)')
    .order('created_at', { ascending: false })
    .limit(filter?.limit ?? 100);
  if (filter?.entityType && filter?.entityId) {
    q = q.eq('entity_type', filter.entityType).eq('entity_id', filter.entityId);
  } else if (filter?.entityType) {
    q = q.eq('entity_type', filter.entityType);
  }
  if (filter?.actorId) q = q.eq('actor_id', filter.actorId);
  if (filter?.kind) q = q.eq('kind', filter.kind);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as WorkspaceEvent[];
}

export async function logEvent(
  kind: string,
  entityType: string,
  entityId: string | null,
  entityTitle: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from('events').insert({
    kind, entity_type: entityType, entity_id: entityId, entity_title: entityTitle, payload,
  });
  // Non-fatal: timeline must never break the operation itself
  if (error) console.error('event log failed', error);
}
