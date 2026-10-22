import {
  approvalDecisionFor,
  approvalSecondsLeft,
  leaseSecondsLeft,
} from '@/lib/agent-flow/lease';
import type {
  ActivityEntry,
  Agent,
  ApiToken,
  Approval,
  Artifact,
  Delegation,
  Label,
  Note,
  Project,
  Run,
  RunLog,
  Task,
  Webhook,
} from '@/lib/db/schema';
import type {
  ActivityDTO,
  AgentDTO,
  AgentRef,
  ApiTokenDTO,
  ApprovalDTO,
  ArtifactDTO,
  DelegationDTO,
  LabelDTO,
  LabelRef,
  Milestone,
  NoteDTO,
  ProjectDTO,
  ProjectRef,
  RunDTO,
  RunLogDTO,
  TaskDTO,
  WebhookDTO,
} from '@/lib/types';
import { webhookSecretPreview } from '@/lib/webhook';

/** Normalises a timestamp column to an ISO string (or null). */
function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type TaskSource = Task & {
  project?: ProjectRef | null;
  labels?: LabelRef[];
  subtaskTotal?: number;
  subtaskDone?: number;
  /** Name of the agent holding the lease, when the query joined it in. */
  claimedByAgentName?: string | null;
  /** Display name of the current task assignee, when assigned. */
  assigneeName?: string | null;
};

export function serializeTask(task: TaskSource): TaskDTO {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
    assigneeName: task.assigneeName ?? null,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    recurrence: task.recurrence,
    sortOrder: task.sortOrder,
    completedAt: iso(task.completedAt),
    createdAt: iso(task.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(task.updatedAt) ?? new Date(0).toISOString(),
    project: task.project ?? null,
    labels: task.labels ?? [],
    subtaskTotal: task.subtaskTotal ?? 0,
    subtaskDone: task.subtaskDone ?? 0,
    autonomy: task.autonomy,
    claimedByAgentId: task.claimedByAgentId,
    claimedByAgentName: task.claimedByAgentName ?? null,
    leaseExpiresAt: iso(task.leaseExpiresAt),
    heartbeatAt: iso(task.heartbeatAt),
    claimCount: task.claimCount,
    // Computed rather than stored: a countdown goes stale the moment it is
    // written, and the UI needs it fresh on every render.
    leaseSecondsLeft: leaseSecondsLeft(task),
  };
}

export type ApprovalSource = Approval & {
  task?: { id: string; title: string; status: TaskDTO['status'] } | null;
  agent?: AgentRef | null;
  decidedByUserName?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The `decision` field is where fail-closed becomes visible to the caller: an
 * approval whose deadline has gone by reports `rejected`, so neither the agent
 * nor the UI has to remember the rule.
 */
export function serializeApproval(approval: ApprovalSource): ApprovalDTO {
  const expiresAt = iso(approval.expiresAt) ?? new Date(0).toISOString();

  return {
    id: approval.id,
    taskId: approval.taskId,
    agentId: approval.agentId,
    runId: approval.runId,
    tool: approval.tool,
    risk: approval.risk,
    status: approval.status,
    title: approval.title,
    summary: approval.summary,
    payload: asRecord(approval.payload),
    payloadEdited:
      approval.payloadEdited === null || approval.payloadEdited === undefined
        ? null
        : asRecord(approval.payloadEdited),
    reason: approval.reason,
    decidedByUserId: approval.decidedByUserId,
    decidedByUserName: approval.decidedByUserName ?? null,
    decidedAt: iso(approval.decidedAt),
    expiresAt,
    createdAt: iso(approval.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(approval.updatedAt) ?? new Date(0).toISOString(),
    secondsLeft: approvalSecondsLeft(approval),
    decision: approvalDecisionFor(approval),
    task: approval.task ?? null,
    agent: approval.agent ?? null,
  };
}

export function serializeMilestones(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.title !== 'string') return [];
    return [
      {
        title: record.title,
        done: record.done === true,
        date: typeof record.date === 'string' ? record.date : null,
      },
    ];
  });
}

export function serializeProject(
  project: Project,
  counts: { taskTotal: number; taskDone: number },
): ProjectDTO {
  return {
    id: project.id,
    identifier: project.identifier,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color,
    targetDate: project.targetDate,
    milestones: serializeMilestones(project.milestones),
    sortOrder: project.sortOrder,
    archivedAt: iso(project.archivedAt),
    createdAt: iso(project.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(project.updatedAt) ?? new Date(0).toISOString(),
    taskTotal: counts.taskTotal,
    taskDone: counts.taskDone,
  };
}

export function serializeLabel(label: Label, usage: number): LabelDTO {
  return { id: label.id, name: label.name, color: label.color, usage };
}

export function serializeNote(note: Note): NoteDTO {
  return {
    id: note.id,
    title: note.title,
    contentMd: note.contentMd,
    source: note.source,
    authorType: note.authorType,
    authorId: note.authorId,
    authorName: note.authorName,
    projectId: note.projectId,
    taskId: note.taskId,
    createdAt: iso(note.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(note.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function serializeActivity(entry: ActivityEntry): ActivityDTO {
  return {
    id: entry.id,
    actorType: entry.actorType,
    actorId: entry.actorId,
    actorName: entry.actorName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    meta: (entry.meta as Record<string, unknown> | null) ?? null,
    createdAt: iso(entry.createdAt) ?? new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Agents, tokens, delegations, runs
// ---------------------------------------------------------------------------

export function serializeAgent(
  agent: Agent,
  counts: {
    tokenCount?: number;
    openDelegations?: number;
    activeRuns?: number;
    lastRunAt?: Date | string | null;
  },
): AgentDTO {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    capabilities: agent.capabilities ?? [],
    status: agent.status,
    createdAt: iso(agent.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(agent.updatedAt) ?? new Date(0).toISOString(),
    tokenCount: counts.tokenCount ?? 0,
    openDelegations: counts.openDelegations ?? 0,
    activeRuns: counts.activeRuns ?? 0,
    lastRunAt: iso(counts.lastRunAt ?? null),
  };
}

export function serializeAgentRef(agent: Pick<Agent, 'id' | 'name'> | null): AgentRef | null {
  return agent ? { id: agent.id, name: agent.name } : null;
}

/** Never leaks `tokenHash`: it only exists to compare against a presented token. */
export function serializeToken(token: ApiToken): ApiTokenDTO {
  return {
    id: token.id,
    agentId: token.agentId,
    name: token.name,
    tokenPrefix: token.tokenPrefix,
    scopes: token.scopes ?? [],
    lastUsedAt: iso(token.lastUsedAt),
    expiresAt: iso(token.expiresAt),
    revokedAt: iso(token.revokedAt),
    createdAt: iso(token.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeDelegation(
  delegation: Delegation,
  related: {
    agent?: Pick<Agent, 'id' | 'name'> | null;
    task?: { id: string; title: string; status: string } | null;
  } = {},
): DelegationDTO {
  return {
    id: delegation.id,
    fromType: delegation.fromType,
    fromId: delegation.fromId,
    toAgentId: delegation.toAgentId,
    taskId: delegation.taskId,
    title: delegation.title,
    instructions: delegation.instructions,
    status: delegation.status,
    requiresApproval: delegation.requiresApproval,
    approvedAt: iso(delegation.approvedAt),
    createdAt: iso(delegation.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(delegation.updatedAt) ?? new Date(0).toISOString(),
    agent: serializeAgentRef(related.agent ?? null),
    task: related.task ?? null,
  };
}

export function serializeRun(
  run: Run,
  related: {
    agent?: Pick<Agent, 'id' | 'name'> | null;
    task?: { id: string; title: string } | null;
    logCount?: number;
    artifactCount?: number;
  } = {},
): RunDTO {
  return {
    id: run.id,
    agentId: run.agentId,
    taskId: run.taskId,
    delegationId: run.delegationId,
    status: run.status,
    input: run.input ?? null,
    output: run.output,
    error: run.error,
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    durationMs: run.durationMs,
    // `numeric` travels as a string to avoid floating point surprises.
    costUsd: run.costUsd === null || run.costUsd === undefined ? null : Number(run.costUsd),
    createdAt: iso(run.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(run.updatedAt) ?? new Date(0).toISOString(),
    agent: serializeAgentRef(related.agent ?? null),
    task: related.task ?? null,
    logCount: related.logCount ?? 0,
    artifactCount: related.artifactCount ?? 0,
  };
}

export function serializeRunLog(log: RunLog): RunLogDTO {
  return {
    id: log.id,
    runId: log.runId,
    level: log.level,
    message: log.message,
    createdAt: iso(log.createdAt) ?? new Date(0).toISOString(),
  };
}

export function serializeArtifact(artifact: Artifact): ArtifactDTO {
  return {
    id: artifact.id,
    runId: artifact.runId,
    taskId: artifact.taskId,
    name: artifact.name,
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    content: artifact.kind === 'text' ? artifact.content : null,
    downloadUrl: artifact.kind === 'file' ? `/api/artifacts/${artifact.id}` : null,
    createdAt: iso(artifact.createdAt) ?? new Date(0).toISOString(),
  };
}

/**
 * The signing secret is summarised, never returned in full.
 *
 * It is the one credential that has to be stored in clear text (signing needs
 * the original value), so the cheapest protection left is not shipping it to
 * every page render: it is shown once, when it is created or rotated.
 */
export function serializeWebhook(webhook: Webhook): WebhookDTO {
  return {
    id: webhook.id,
    name: webhook.name,
    url: webhook.url,
    events: webhook.events ?? [],
    active: webhook.active,
    secretPreview: webhookSecretPreview(webhook.secret),
    lastDeliveryAt: iso(webhook.lastDeliveryAt),
    lastStatus: webhook.lastStatus,
    lastError: webhook.lastError,
    deliveryCount: webhook.deliveryCount,
    failureCount: webhook.failureCount,
    createdAt: iso(webhook.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(webhook.updatedAt) ?? new Date(0).toISOString(),
  };
}
