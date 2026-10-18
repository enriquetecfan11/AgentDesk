/**
 * Data-transfer shapes handed from Server Components to Client Components.
 *
 * Everything is JSON-safe: timestamps are ISO strings, not `Date` instances.
 * This is the contract the UI codes against, so the domain layer is free to
 * change how it reads the database.
 */
import type {
  ApprovalStatusValue,
  RiskLevelValue,
  TaskAutonomyValue,
  TaskPriorityValue,
  TaskStatusValue,
} from '@/lib/constants';

export type ProjectRef = {
  id: string;
  name: string;
  identifier: string | null;
  color: string | null;
};

export type LabelRef = {
  id: string;
  name: string;
  color: string | null;
};

export type TaskDTO = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusValue;
  priority: TaskPriorityValue;
  projectId: string | null;
  parentTaskId: string | null;
  assigneeType: 'human' | 'agent' | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: ProjectRef | null;
  labels: LabelRef[];
  subtaskTotal: number;
  subtaskDone: number;

  /** How much the agent working this task may do on its own. */
  autonomy: TaskAutonomyValue;
  /** Lease, when an agent currently holds the task. */
  claimedByAgentId: string | null;
  claimedByAgentName: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  claimCount: number;
  /** Seconds left on the lease; null when nobody holds it. */
  leaseSecondsLeft: number | null;
};

export type ProjectDTO = {
  id: string;
  identifier: string | null;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  color: string | null;
  targetDate: string | null;
  milestones: Milestone[];
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  taskTotal: number;
  taskDone: number;
};

export type Milestone = { title: string; done: boolean; date?: string | null };

export type LabelDTO = {
  id: string;
  name: string;
  color: string | null;
  usage: number;
};

export type ActivityDTO = {
  id: string;
  actorType: 'human' | 'agent' | 'system';
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type ApprovalDTO = {
  id: string;
  taskId: string;
  agentId: string;
  runId: string | null;
  tool: string;
  risk: RiskLevelValue;
  status: ApprovalStatusValue;
  title: string;
  summary: string | null;
  /** The exact arguments the agent sent. Shown verbatim, never rewritten. */
  payload: Record<string, unknown>;
  /** Present only when a person changed the arguments before approving. */
  payloadEdited: Record<string, unknown> | null;
  reason: string | null;
  decidedByUserId: string | null;
  decidedByUserName: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  /** Seconds before it lapses; null once decided. */
  secondsLeft: number | null;
  /** What the agent should do: `expired` is reported as `rejected`. */
  decision: 'pending' | 'approved' | 'rejected' | 'cancelled';
  task: { id: string; title: string; status: TaskStatusValue } | null;
  agent: AgentRef | null;
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type NoteDTO = {
  id: string;
  title: string;
  contentMd: string;
  source: 'app' | 'obsidian';
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Minimal reference used by the backlink and outgoing-link lists. */
export type NoteRef = { id: string; title: string };

export type NoteListItemDTO = {
  id: string;
  title: string;
  /** Plain-text beginning of the note, for the list. */
  excerpt: string;
  projectId: string | null;
  project: ProjectRef | null;
  updatedAt: string;
  createdAt: string;
  /** Notes this one links to. */
  outgoingCount: number;
  /** Notes that link to this one. */
  backlinkCount: number;
};

export type NoteDetailDTO = {
  note: NoteDTO;
  project: ProjectRef | null;
  /** Notes pointing here. */
  backlinks: NoteRef[];
  /** Targets of this note's `[[links]]`; `note: null` means it does not exist yet. */
  outgoing: { title: string; note: NoteRef | null }[];
  /** Other notes sharing the same project, used as a plain "related" list. */
  related: NoteRef[];
};

// ---------------------------------------------------------------------------
// Agents and credentials
// ---------------------------------------------------------------------------

export type AgentRef = { id: string; name: string };

export type AgentDTO = {
  id: string;
  name: string;
  description: string | null;
  capabilities: string[];
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
  /** Live tokens (not revoked). */
  tokenCount: number;
  /** Delegations waiting for the agent or for a human approval. */
  openDelegations: number;
  activeRuns: number;
  lastRunAt: string | null;
};

/** A token as it is listed. The secret itself is never in here. */
export type ApiTokenDTO = {
  id: string;
  agentId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

/** Returned exactly once, when the token is created. */
export type ApiTokenCreatedDTO = {
  token: ApiTokenDTO;
  /** The only time this value exists outside the agent's own configuration. */
  secret: string;
};

// ---------------------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------------------

export type DelegationDTO = {
  id: string;
  fromType: 'human' | 'agent' | 'system';
  fromId: string | null;
  toAgentId: string;
  taskId: string | null;
  title: string;
  instructions: string | null;
  status:
    | 'pending'
    | 'accepted'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'rejected'
    | 'cancelled';
  requiresApproval: boolean;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  agent: AgentRef | null;
  task: { id: string; title: string; status: string } | null;
};

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunDTO = {
  id: string;
  agentId: string;
  taskId: string | null;
  delegationId: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  input: unknown;
  output: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
  agent: AgentRef | null;
  task: { id: string; title: string } | null;
  logCount: number;
  artifactCount: number;
};

export type RunLogDTO = {
  id: string;
  runId: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
};

export type ArtifactDTO = {
  id: string;
  runId: string | null;
  taskId: string | null;
  name: string;
  kind: 'file' | 'text' | 'url';
  mimeType: string | null;
  sizeBytes: number | null;
  /** Inline body, only for `kind = 'text'`. */
  content: string | null;
  /** Where to fetch a stored file, only for `kind = 'file'`. */
  downloadUrl: string | null;
  createdAt: string;
};

export type RunDetailDTO = {
  run: RunDTO;
  logs: RunLogDTO[];
  artifacts: ArtifactDTO[];
};

/** What an agent sees when it asks for work. */
export type QueueDTO = {
  agent: { id: string; name: string; status: string; capabilities: string[] };
  delegations: DelegationDTO[];
  tasks: TaskDTO[];
};

export type TaskCommentDTO = {
  id: string;
  taskId: string;
  authorType: 'human' | 'agent' | 'system';
  authorName: string;
  body: string;
  createdAt: string;
};

/** Outgoing webhook. The raw `secret` is never part of this shape. */
export type WebhookDTO = {
  id: string;
  name: string;
  url: string;
  /** Event names, `area.*` families or `*`. */
  events: string[];
  active: boolean;
  secretPreview: string;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
  deliveryCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
};

/** What a manual "Probar" click got back from the endpoint. */
export type WebhookTestResultDTO = {
  ok: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
  /** First part of the response body, to see what the receiver answered. */
  body: string | null;
};
