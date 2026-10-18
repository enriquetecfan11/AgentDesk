export type ActorKind = 'human' | 'agent' | 'automation';
export type ActorStatus = 'active' | 'paused' | 'archived';
export type ProjectStatus = 'active' | 'paused' | 'archived';
export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export type TaskOrigin = 'human' | 'agent' | 'automation';
export type AgentKind = 'organizer' | 'executor' | 'analyst';
export type AgentStatus = 'active' | 'paused';
export type DelegationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type RunStatus = 'started' | 'running' | 'succeeded' | 'failed';
export type NoteSource = 'app' | 'obsidian';

export interface Actor {
  id: string;
  kind: ActorKind;
  name: string;
  display_name: string | null;
  color: string | null;
  status: ActorStatus;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  kind: AgentKind;
  tool: string | null;
  capabilities: string[];
  permissions: string[];
  token_prefix: string | null;
  status: AgentStatus;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentWithActor extends Agent {
  actor: Actor | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  completed_at: string | null;
  project_id: string | null;
  parent_task_id: string | null;
  assignee_id: string | null;
  origin: TaskOrigin;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskWithRefs extends Task {
  project: Project | null;
  assignee: Actor | null;
}

export interface Note {
  id: string;
  title: string;
  body_md: string;
  project_id: string | null;
  task_id: string | null;
  source: NoteSource;
  vault_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface Delegation {
  id: string;
  task_id: string;
  agent_id: string;
  brief: string;
  limits: string | null;
  completion_criteria: string | null;
  status: DelegationStatus;
  created_at: string;
  updated_at: string;
}

export interface DelegationWithContext extends Delegation {
  agent: Agent | null;
  context: DelegationContextItem[];
}

export interface DelegationContextItem {
  id: string;
  delegation_id: string;
  kind: 'note' | 'artifact' | 'url' | 'decision';
  ref_id: string | null;
  url: string | null;
  description: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  delegation_id: string;
  agent_id: string;
  status: RunStatus;
  input: Record<string, unknown>;
  summary: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface Artifact {
  id: string;
  run_id: string | null;
  task_id: string | null;
  project_id: string | null;
  kind: 'text' | 'code' | 'url' | 'file';
  title: string;
  content_text: string | null;
  storage_path: string | null;
  url: string | null;
  created_at: string;
}

export interface Decision {
  id: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  what: string;
  why: string | null;
  decided_by: string | null;
  alternatives: string[];
  decided_at: string;
  created_at: string;
}

export interface Automation {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  output_webhook_url: string | null;
  secret_prefix: string | null;
  status: AgentStatus;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceEvent {
  id: string;
  kind: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  entity_title: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  actor?: Actor | null;
}

export const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'review', label: 'En revisión' },
  { value: 'done', label: 'Hecho' },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgente', color: '#ef4444' },
  { value: 'high', label: 'Alta', color: '#f97316' },
  { value: 'normal', label: 'Normal', color: '#6b7280' },
  { value: 'low', label: 'Baja', color: '#94a3b8' },
];

export const AGENT_KINDS: { value: AgentKind; label: string }[] = [
  { value: 'organizer', label: 'Organizador' },
  { value: 'executor', label: 'Ejecutor' },
  { value: 'analyst', label: 'Analista' },
];

export const DELEGATION_STATUSES: { value: DelegationStatus; label: string }[] = [
  { value: 'pending', label: 'Pendiente' },
  { value: 'in_progress', label: 'En curso' },
  { value: 'completed', label: 'Completada' },
  { value: 'failed', label: 'Fallida' },
  { value: 'cancelled', label: 'Cancelada' },
];

export const RUN_STATUSES: { value: RunStatus; label: string }[] = [
  { value: 'started', label: 'Iniciado' },
  { value: 'running', label: 'Ejecutando' },
  { value: 'succeeded', label: 'Éxito' },
  { value: 'failed', label: 'Fallo' },
];
