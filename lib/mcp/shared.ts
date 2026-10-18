import 'server-only';

import type { ZodType } from 'zod';

import { gate, type McpToolName } from '@/lib/agent-flow/policy';
import { hasScope, type AgentScope } from '@/lib/agent-token';
import { agentActivityActor, type AgentActor } from '@/lib/auth/agent';
import { holdsLease } from '@/lib/agent-flow/lease';
import { createApproval } from '@/lib/domain/approvals';
import { logActivity } from '@/lib/domain/activity';
import { createRun, listRuns } from '@/lib/domain/runs';
import { getTask } from '@/lib/domain/tasks';
import type { ApprovalDTO, RunDTO, TaskDTO } from '@/lib/types';

/**
 * The plumbing every MCP tool shares: scopes, the approval gate, the lease
 * check and the one run per task.
 *
 * Tools call the domain layer directly. There is no HTTP hop to `/api/v1` any
 * more — the old stdio server had to make one because it ran in a different
 * process, and keeping it would mean a request that authenticates twice and
 * loses its error detail in translation.
 */

export type ToolContext = { actor: AgentActor };

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema, by hand. The real validation is the zod `schema` below. */
  inputSchema: Record<string, unknown>;
  schema: ZodType<never> | ZodType<unknown>;
  /**
   * Which policy entry gates this tool.
   *
   * Null means "no gate": reads and narration. Everything that can change the
   * work names an entry, including the older workspace tools — otherwise
   * `update_task` would be a way around `update_task_status`, and a gate with
   * a way around it is decoration.
   */
  gatedAs: McpToolName | null;
  scope: AgentScope;
  run: (ctx: ToolContext, args: never) => Promise<unknown>;
};

/** A tool that could not do its job. Rendered as `isError: true` text. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function requireScope(actor: AgentActor, scope: AgentScope): void {
  if (!hasScope(actor.scopes, scope)) {
    // Same wording as the API's 403, so an operator searching for the message
    // finds one answer rather than two.
    throw new ToolError(`El token no tiene el scope ${scope}`);
  }
}

export function parseArgs<T>(schema: ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args);
  if (parsed.success) return parsed.data;

  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ');
  throw new ToolError(`Argumentos inválidos — ${detail}`);
}

export async function loadTask(taskId: string): Promise<TaskDTO> {
  const task = await getTask(taskId);
  if (!task) throw new ToolError(`No existe la tarea ${taskId}`);
  return task;
}

/**
 * Refuses to let an agent move a task it is not holding.
 *
 * Not bureaucracy: the lease is the only thing that stops two runners from
 * closing the same task twice, so the tools that close or advance work insist
 * on it. The message says what to do about it.
 */
export function requireLease(task: TaskDTO, actor: AgentActor): void {
  if (holdsLease({ claimedByAgentId: task.claimedByAgentId, leaseExpiresAt: task.leaseExpiresAt }, actor.agentId)) {
    return;
  }

  if (task.claimedByAgentId && task.claimedByAgentId !== actor.agentId) {
    throw new ToolError(
      `La tarea la tiene «${task.claimedByAgentName ?? task.claimedByAgentId}» y su lease sigue vivo`,
    );
  }

  throw new ToolError('No tienes el lease de esta tarea: llama antes a claim_task');
}

export type GateOutcome =
  | { parked: ApprovalDTO }
  | { parked: null; notice: boolean; reason: string };

export type ApprovalDraft = {
  /** What to call the parked action. Defaults to the tool's own name. */
  tool?: string;
  title: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  runId?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Runs the gate, and parks the action when the answer is no.
 *
 * The approval row carries the arguments **exactly as the agent sent them**:
 * the inbox shows that payload verbatim, because a summary of what you are
 * approving is not what you are approving.
 */
export async function gateOrPark(
  ctx: ToolContext,
  tool: McpToolName,
  task: TaskDTO,
  draft: ApprovalDraft,
): Promise<GateOutcome> {
  const decision = gate(tool, task.autonomy);

  if (decision.effect === 'allow') {
    return { parked: null, notice: false, reason: decision.reason };
  }

  if (decision.effect === 'notice') {
    await logActivity({
      actor: agentActivityActor(ctx.actor),
      // One action name for every notice, with the tool in the metadata: the
      // timeline reads better as "actuó con aviso: create_subtask" than as a
      // family of near-identical verbs, and `agent.*` already means something
      // else here (the agent itself being created or edited).
      action: 'agent.notice',
      entityType: 'task',
      entityId: task.id,
      meta: {
        notice: true,
        tool,
        risk: decision.risk,
        reason: decision.reason,
        title: draft.title,
        payload: draft.payload,
      },
    });
    return { parked: null, notice: true, reason: decision.reason };
  }

  const approval = await createApproval({
    taskId: task.id,
    agentId: ctx.actor.agentId,
    tool: draft.tool ?? tool,
    risk: decision.risk,
    title: draft.title,
    summary: draft.summary ?? decision.reason,
    payload: draft.payload,
    runId: draft.runId ?? null,
    idempotencyKey: draft.idempotencyKey ?? null,
  });

  await logActivity({
    actor: agentActivityActor(ctx.actor),
    action: 'approval.requested',
    entityType: 'approval',
    entityId: approval.id,
    meta: {
      taskId: task.id,
      tool: approval.tool,
      risk: approval.risk,
      title: approval.title,
      autonomy: task.autonomy,
    },
  });

  return { parked: approval };
}

/** What a parked tool call tells the agent. */
export function parkedResult(approval: ApprovalDTO) {
  return {
    status: 'pending_approval',
    approvalId: approval.id,
    tool: approval.tool,
    risk: approval.risk,
    expiresAt: approval.expiresAt,
    payload: approval.payload,
    message:
      'No se ha ejecutado nada: queda en pausa hasta que una persona lo decida en la web. ' +
      'Llama a get_task para leer la decisión; una aprobación caducada se lee como rechazo.',
  };
}

/**
 * The run this agent is writing for this task, opening one if there is none.
 *
 * This is what "one run per task" rests on: the lease means only one agent is
 * working the task, and this means that agent keeps appending to the same run
 * instead of opening a fresh one on every cron pass.
 */
export async function runForTask(taskId: string, actor: AgentActor): Promise<RunDTO> {
  const open = await listRuns({
    agentId: actor.agentId,
    taskId,
    statuses: ['queued', 'running'],
    limit: 1,
  });

  if (open[0]) return open[0];

  return createRun({ agentId: actor.agentId, taskId, status: 'running' });
}

/** Trims a task down to what an agent actually needs to decide what to do. */
export function taskBrief(task: TaskDTO) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    autonomy: task.autonomy,
    projectId: task.projectId,
    project: task.project?.name ?? null,
    parentTaskId: task.parentTaskId,
    labels: task.labels.map((label) => label.name),
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
    claimedByAgentId: task.claimedByAgentId,
    leaseExpiresAt: task.leaseExpiresAt,
    leaseSecondsLeft: task.leaseSecondsLeft,
    // Worth showing an agent: a task it keeps taking and dropping is a loop it
    // is in, and nothing else in the payload would tell it so.
    claimCount: task.claimCount,
    subtaskTotal: task.subtaskTotal,
    subtaskDone: task.subtaskDone,
  };
}
