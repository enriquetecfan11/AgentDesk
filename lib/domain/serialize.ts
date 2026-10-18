import type {
  ActivityEntry,
  Agent,
  ApiToken,
  Artifact,
  Delegation,
  Label,
  Note,
  Project,
  Run,
  RunLog,
  Task,
} from '@/lib/db/schema';
import type {
  ActivityDTO,
  AgentDTO,
  AgentRef,
  ApiTokenDTO,
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
} from '@/lib/types';

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
