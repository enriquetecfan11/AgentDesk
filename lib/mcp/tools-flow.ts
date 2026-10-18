import 'server-only';

import { z } from 'zod';

import { approvalDecisionFor } from '@/lib/agent-flow/lease';
import { agentActivityActor } from '@/lib/auth/agent';
import { TASK_STATUSES } from '@/lib/constants';
import { logActivity } from '@/lib/domain/activity';
import { listApprovalsForTask } from '@/lib/domain/approvals';
import {
  claimNextTask,
  claimTask,
  releaseExpiredLeases,
  releaseLease,
  renewLease,
} from '@/lib/domain/claims';
import { addTaskComment, listTaskComments } from '@/lib/domain/comments';
import { appendRunLogs, createArtifact, listRuns, updateRun } from '@/lib/domain/runs';
import { createTask, getSubtasks, listTasks, updateTask } from '@/lib/domain/tasks';
import {
  gateOrPark,
  loadTask,
  parkedResult,
  parseArgs,
  requireLease,
  requireScope,
  runForTask,
  taskBrief,
  ToolError,
  type ToolContext,
  type ToolDefinition,
} from '@/lib/mcp/shared';
import { artifactCreateSchema } from '@/lib/validation';

/**
 * The thirteen tools of the «tarea → el agente la revisa → delega o ejecuta»
 * flow.
 *
 * Reading and narrating are free. Taking and advancing a task need the lease.
 * Delegating, executing, sending or deleting never happen here: they are
 * parked as approvals, and the agent carries them out itself once a person has
 * said yes. AgentDesk is the gate, not the executor.
 */

const uuid = z.uuid();

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const listTasksArgs = z.object({
  status: z.string().trim().max(200).optional(),
  projectId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
  mine: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const listTasksTool: ToolDefinition = {
  name: 'list_tasks',
  description:
    'Lista tareas. Filtros opcionales: status (coma-separado), projectId, q (busca en el título), ' +
    'mine (solo las asignadas a ti). Devuelve también la autonomía y el lease de cada tarea.',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', description: 'backlog,todo,in_progress,review,done,cancelled' },
      projectId: { type: 'string' },
      q: { type: 'string' },
      mine: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    additionalProperties: false,
  },
  schema: listTasksArgs,
  gatedAs: null,
  scope: 'tasks:read',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(listTasksArgs, raw);
    // Sweeping here means the list never shows a task as taken by an agent
    // that has gone quiet.
    await releaseExpiredLeases();

    const statuses = args.status
      ?.split(',')
      .map((value) => value.trim())
      .filter((value): value is (typeof TASK_STATUSES)[number] =>
        (TASK_STATUSES as readonly string[]).includes(value),
      );

    const tasks = await listTasks({
      statuses: statuses?.length ? statuses : undefined,
      projectId: args.projectId,
      search: args.q,
      assigneeType: args.mine ? 'agent' : undefined,
      assigneeId: args.mine ? ctx.actor.agentId : undefined,
      limit: args.limit ?? 50,
      orderBy: 'priority',
    });

    return { count: tasks.length, tasks: tasks.map(taskBrief) };
  },
};

const getTaskArgs = z.object({ taskId: uuid });

const getTaskTool: ToolDefinition = {
  name: 'get_task',
  description:
    'Una tarea con todo su contexto: subtareas, comentarios, el run abierto y sus aprobaciones. ' +
    'Es también la forma de leer una decisión: cada aprobación trae decision, reason y payloadEdited. ' +
    'Una aprobación caducada llega como decision="rejected".',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
    additionalProperties: false,
  },
  schema: getTaskArgs,
  gatedAs: null,
  scope: 'tasks:read',
  run: async (ctx: ToolContext, raw) => {
    const { taskId } = parseArgs(getTaskArgs, raw);
    const task = await loadTask(taskId);

    const [subtasks, comments, approvals, openRuns] = await Promise.all([
      getSubtasks(taskId),
      listTaskComments(taskId, 50),
      listApprovalsForTask(taskId),
      listRuns({ agentId: ctx.actor.agentId, taskId, statuses: ['queued', 'running'], limit: 1 }),
    ]);

    return {
      task: { ...taskBrief(task), description: task.description },
      subtasks: subtasks.map((subtask) => ({
        id: subtask.id,
        title: subtask.title,
        status: subtask.status,
      })),
      comments: comments.map((comment) => ({
        author: comment.authorName,
        authorType: comment.authorType,
        body: comment.body,
        at: comment.createdAt,
      })),
      approvals: approvals.map((approval) => ({
        id: approval.id,
        tool: approval.tool,
        risk: approval.risk,
        status: approval.status,
        decision: approvalDecisionFor({ status: approval.status, expiresAt: approval.expiresAt }),
        title: approval.title,
        payload: approval.payload,
        // Present only when a person changed the arguments. Use these, not the
        // ones you sent.
        payloadEdited: approval.payloadEdited,
        reason: approval.reason,
        decidedAt: approval.decidedAt,
        expiresAt: approval.expiresAt,
      })),
      // One run per task: reuse this one, do not open another.
      openRun: openRuns[0] ? { id: openRuns[0].id, status: openRuns[0].status } : null,
    };
  },
};

// ---------------------------------------------------------------------------
// Taking work
// ---------------------------------------------------------------------------

const getNextTaskArgs = z.object({
  projectId: uuid.optional(),
  includeUnassigned: z.boolean().optional(),
});

const getNextTaskTool: ToolDefinition = {
  name: 'get_next_task',
  description:
    'Reclama de forma atómica la siguiente tarea que te toca y devuelve su lease. ' +
    'Dos runners simultáneos reciben tareas distintas, nunca la misma. ' +
    'Las tareas en autonomía suggest_only no se reclaman: esas se leen con list_tasks.',
  inputSchema: {
    type: 'object',
    properties: { projectId: { type: 'string' }, includeUnassigned: { type: 'boolean' } },
    additionalProperties: false,
  },
  schema: getNextTaskArgs,
  gatedAs: null,
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(getNextTaskArgs, raw);

    const claim = await claimNextTask(ctx.actor.agentId, {
      projectId: args.projectId,
      includeUnassigned: args.includeUnassigned,
    });

    if (!claim) return { task: null, message: 'No hay nada pendiente que puedas reclamar ahora' };
    if (!claim.ok) throw new ToolError('No se pudo reclamar ninguna tarea');

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.claimed',
      entityType: 'task',
      entityId: claim.task.id,
      meta: { title: claim.task.title, via: 'get_next_task', leaseExpiresAt: claim.leaseExpiresAt },
    });

    return {
      task: taskBrief(claim.task),
      claimId: claim.claimId,
      leaseExpiresAt: claim.leaseExpiresAt,
      hint: 'Vuelve a llamar a claim_task para renovar el lease antes de que caduque.',
    };
  },
};

const claimTaskArgs = z.object({ taskId: uuid });

const claimTaskTool: ToolDefinition = {
  name: 'claim_task',
  description:
    'Reclama una tarea concreta. Si ya la tienes, renueva el lease: esta llamada es el heartbeat. ' +
    'Si la tiene otro agente y su lease sigue vivo, falla.',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
    additionalProperties: false,
  },
  schema: claimTaskArgs,
  gatedAs: 'claim_task',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const { taskId } = parseArgs(claimTaskArgs, raw);
    const task = await loadTask(taskId);

    const decision = await gateOrPark(ctx, 'claim_task', task, {
      title: `Tomar la tarea «${task.title}»`,
      payload: { taskId },
    });
    if (decision.parked) return parkedResult(decision.parked);

    const claim = await claimTask(taskId, ctx.actor.agentId);

    if (!claim.ok) {
      if (claim.reason === 'not_found') throw new ToolError(`No existe la tarea ${taskId}`);
      if (claim.reason === 'closed') throw new ToolError('La tarea ya está cerrada');
      throw new ToolError('La tarea la tiene otro agente y su lease sigue vivo');
    }

    if (!claim.renewed) {
      await logActivity({
        actor: agentActivityActor(ctx.actor),
        action: 'task.claimed',
        entityType: 'task',
        entityId: taskId,
        meta: { title: claim.task.title, via: 'claim_task', leaseExpiresAt: claim.leaseExpiresAt },
      });
    }

    return {
      task: taskBrief(claim.task),
      claimId: claim.claimId,
      leaseExpiresAt: claim.leaseExpiresAt,
      renewed: claim.renewed,
    };
  },
};

// ---------------------------------------------------------------------------
// Advancing work
// ---------------------------------------------------------------------------

const updateStatusArgs = z.object({
  taskId: uuid,
  status: z.enum(TASK_STATUSES),
  note: z.string().trim().max(4000).optional(),
});

const updateTaskStatusTool: ToolDefinition = {
  name: 'update_task_status',
  description:
    'Cambia el estado de una tarea que tienes reclamada. Renueva el lease de paso. ' +
    'El campo note, si lo mandas, queda como comentario en la tarea.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      status: { type: 'string', enum: [...TASK_STATUSES] },
      note: { type: 'string' },
    },
    required: ['taskId', 'status'],
    additionalProperties: false,
  },
  schema: updateStatusArgs,
  gatedAs: 'update_task_status',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(updateStatusArgs, raw);
    const task = await loadTask(args.taskId);

    const decision = await gateOrPark(ctx, 'update_task_status', task, {
      title: `Pasar «${task.title}» a ${args.status}`,
      payload: { taskId: args.taskId, status: args.status, note: args.note ?? null },
    });
    if (decision.parked) return parkedResult(decision.parked);

    requireLease(task, ctx.actor);

    const updated = await updateTask(args.taskId, { status: args.status });
    if (!updated) throw new ToolError(`No existe la tarea ${args.taskId}`);

    if (args.note) {
      await addTaskComment(args.taskId, agentActivityActor(ctx.actor), args.note);
    }

    await renewLease(args.taskId, ctx.actor.agentId);

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.updated',
      entityType: 'task',
      entityId: args.taskId,
      meta: { status: args.status, via: 'mcp' },
    });

    return { task: taskBrief(updated.task) };
  },
};

const addCommentArgs = z.object({
  taskId: uuid,
  body: z.string().trim().min(1, 'El comentario no puede estar vacío').max(20_000),
});

const addCommentTool: ToolDefinition = {
  name: 'add_comment',
  description:
    'Comenta en una tarea. Libre en cualquier autonomía: es la forma de dejar constancia de lo ' +
    'que piensas hacer sin hacerlo todavía. Renueva el lease si lo tienes.',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' }, body: { type: 'string' } },
    required: ['taskId', 'body'],
    additionalProperties: false,
  },
  schema: addCommentArgs,
  gatedAs: null,
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(addCommentArgs, raw);
    await loadTask(args.taskId);

    const comment = await addTaskComment(args.taskId, agentActivityActor(ctx.actor), args.body);
    await renewLease(args.taskId, ctx.actor.agentId);

    return { comment: { id: comment.id, at: comment.createdAt } };
  },
};

const appendLogArgs = z.object({
  taskId: uuid.optional(),
  runId: uuid.optional(),
  message: z.string().trim().min(1).max(20_000),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});

const appendLogTool: ToolDefinition = {
  name: 'append_log',
  description:
    'Escribe una línea en el run de la tarea. Si no hay run abierto, lo abre; si hay, reutiliza ' +
    'ese mismo (un solo run por tarea). Renueva el lease, así que es el latido natural de un runner.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      runId: { type: 'string' },
      message: { type: 'string' },
      level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
    },
    required: ['message'],
    additionalProperties: false,
  },
  schema: appendLogArgs,
  gatedAs: null,
  scope: 'runs:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(appendLogArgs, raw);
    if (!args.taskId && !args.runId) {
      throw new ToolError('Dime en qué tarea (taskId) o en qué run (runId) quieres escribir');
    }

    const runId = args.runId ?? (await runForTask(args.taskId!, ctx.actor)).id;
    const logs = await appendRunLogs(runId, [
      { level: args.level ?? 'info', message: args.message },
    ]);
    if (logs.length === 0) throw new ToolError(`No existe el run ${runId}`);

    const renewed = args.taskId ? await renewLease(args.taskId, ctx.actor.agentId) : false;

    return { runId, leaseRenewed: renewed };
  },
};

const attachArtifactArgs = artifactCreateSchema;

const attachArtifactTool: ToolDefinition = {
  name: 'attach_artifact',
  description:
    'Adjunta lo que has producido: texto en línea, una URL o un fichero en base64 (máx. 8 MB). ' +
    'Si mandas taskId y no runId, se cuelga del run abierto de esa tarea.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: ['file', 'text', 'url'] },
      mimeType: { type: 'string' },
      content: { type: 'string' },
      contentBase64: { type: 'string' },
      runId: { type: 'string' },
      taskId: { type: 'string' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  schema: attachArtifactArgs,
  gatedAs: null,
  scope: 'runs:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(attachArtifactArgs, raw);

    const runId = args.runId ?? (args.taskId ? (await runForTask(args.taskId, ctx.actor)).id : null);
    const artifact = await createArtifact({ ...args, runId });

    if (args.taskId) await renewLease(args.taskId, ctx.actor.agentId);

    return { artifact: { id: artifact.id, name: artifact.name, kind: artifact.kind }, runId };
  },
};

// ---------------------------------------------------------------------------
// Breaking work down
// ---------------------------------------------------------------------------

const createSubtaskArgs = z.object({
  parentTaskId: uuid,
  title: z.string().trim().min(1, 'El título es obligatorio').max(500),
  description: z.string().max(20_000).optional(),
  priority: z.enum(['none', 'low', 'normal', 'high', 'urgent']).optional(),
});

const createSubtaskTool: ToolDefinition = {
  name: 'create_subtask',
  description:
    'Parte una tarea en subtareas. Riesgo medio: en do_with_approval pasa pero queda un aviso en ' +
    'la actividad; en suggest_only se queda esperando tu aprobación.',
  inputSchema: {
    type: 'object',
    properties: {
      parentTaskId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['none', 'low', 'normal', 'high', 'urgent'] },
    },
    required: ['parentTaskId', 'title'],
    additionalProperties: false,
  },
  schema: createSubtaskArgs,
  gatedAs: 'create_subtask',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(createSubtaskArgs, raw);
    const parent = await loadTask(args.parentTaskId);

    const decision = await gateOrPark(ctx, 'create_subtask', parent, {
      title: `Crear la subtarea «${args.title}»`,
      payload: { ...args },
    });
    if (decision.parked) return parkedResult(decision.parked);

    const subtask = await createTask({
      title: args.title,
      description: args.description ?? null,
      status: 'todo',
      priority: args.priority ?? parent.priority,
      projectId: parent.projectId,
      parentTaskId: parent.id,
      assigneeType: 'agent',
      assigneeId: ctx.actor.agentId,
      // A subtask inherits the parent's leash. Anything else would make
      // "suggest_only" escapable by creating a child and working that.
      autonomy: parent.autonomy,
    });

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.created',
      entityType: 'task',
      entityId: subtask.id,
      meta: { title: subtask.title, parentTaskId: parent.id, notice: decision.notice, via: 'mcp' },
    });

    return { subtask: taskBrief(subtask), notice: decision.notice };
  },
};

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

const proposeDelegationArgs = z.object({
  taskId: uuid,
  toAgentId: uuid,
  title: z.string().trim().min(1, 'El título es obligatorio').max(300),
  instructions: z.string().trim().max(20_000).optional(),
  summary: z.string().trim().max(20_000).optional(),
});

const proposeDelegationTool: ToolDefinition = {
  name: 'propose_delegation',
  description:
    'Propone pasarle la tarea a otro agente. Nunca delega por su cuenta: crea una aprobación con ' +
    'los argumentos exactos. Si la apruebas, AgentDesk crea la delegación de verdad.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      toAgentId: { type: 'string' },
      title: { type: 'string' },
      instructions: { type: 'string' },
      summary: { type: 'string', description: 'Por qué crees que le toca a ese agente' },
    },
    required: ['taskId', 'toAgentId', 'title'],
    additionalProperties: false,
  },
  schema: proposeDelegationArgs,
  gatedAs: 'propose_delegation',
  scope: 'delegations:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(proposeDelegationArgs, raw);
    const task = await loadTask(args.taskId);

    const decision = await gateOrPark(ctx, 'propose_delegation', task, {
      title: args.title,
      summary: args.summary ?? null,
      payload: {
        toAgentId: args.toAgentId,
        title: args.title,
        instructions: args.instructions ?? null,
        taskId: args.taskId,
      },
    });

    // `propose_delegation` is high risk, so the gate always parks it. The
    // branch is here so a future policy change cannot silently turn a proposal
    // into a delegation nobody approved.
    if (!decision.parked) {
      throw new ToolError('Una delegación siempre necesita aprobación humana');
    }

    return parkedResult(decision.parked);
  },
};

const requestApprovalArgs = z.object({
  taskId: uuid,
  tool: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9_.:-]+$/i, 'El nombre solo admite letras, números, . _ : y -'),
  title: z.string().trim().min(1, 'El título es obligatorio').max(300),
  summary: z.string().trim().max(20_000).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

const requestApprovalTool: ToolDefinition = {
  name: 'request_approval',
  description:
    'Pide permiso para algo que vas a hacer tú fuera de AgentDesk: ejecutar un comando, enviar un ' +
    'correo, borrar algo. Manda el nombre de la acción en tool y sus argumentos exactos en payload: ' +
    'se muestran tal cual. AgentDesk no ejecuta nada, solo decide. Consulta get_task para la ' +
    'respuesta; caducada = rechazada. Reusa idempotencyKey si reintentas.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      tool: { type: 'string', description: 'p. ej. shell.run, email.send, host.delete' },
      title: { type: 'string' },
      summary: { type: 'string' },
      payload: { type: 'object', description: 'Los argumentos exactos de la acción' },
      idempotencyKey: { type: 'string' },
    },
    required: ['taskId', 'tool', 'title'],
    additionalProperties: false,
  },
  schema: requestApprovalArgs,
  gatedAs: 'request_approval',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(requestApprovalArgs, raw);
    const task = await loadTask(args.taskId);

    const decision = await gateOrPark(ctx, 'request_approval', task, {
      tool: args.tool,
      title: args.title,
      summary: args.summary ?? null,
      payload: args.payload ?? {},
      idempotencyKey: args.idempotencyKey ?? null,
    });

    if (!decision.parked) {
      throw new ToolError('request_approval siempre crea una aprobación');
    }

    return parkedResult(decision.parked);
  },
};

// ---------------------------------------------------------------------------
// Closing work
// ---------------------------------------------------------------------------

const completeTaskArgs = z.object({
  taskId: uuid,
  output: z.string().trim().max(200_000).optional(),
  costUsd: z.number().min(0).max(100_000).optional(),
});

const completeTaskTool: ToolDefinition = {
  name: 'complete_task',
  description:
    'Cierra la tarea que tienes reclamada: la pasa a done, cierra su run como succeeded y suelta ' +
    'el lease. Necesitas el lease para llamarla.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      output: { type: 'string' },
      costUsd: { type: 'number' },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  schema: completeTaskArgs,
  gatedAs: 'complete_task',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(completeTaskArgs, raw);
    const task = await loadTask(args.taskId);

    const decision = await gateOrPark(ctx, 'complete_task', task, {
      title: `Cerrar «${task.title}»`,
      payload: { taskId: args.taskId, output: args.output ?? null },
    });
    if (decision.parked) return parkedResult(decision.parked);

    requireLease(task, ctx.actor);

    const open = await listRuns({
      agentId: ctx.actor.agentId,
      taskId: args.taskId,
      statuses: ['queued', 'running'],
      limit: 1,
    });
    if (open[0]) {
      await updateRun(open[0].id, {
        status: 'succeeded',
        output: args.output ?? null,
        costUsd: args.costUsd ?? null,
      });
    }

    const updated = await updateTask(args.taskId, { status: 'done' });
    if (!updated) throw new ToolError(`No existe la tarea ${args.taskId}`);

    // The lease goes before the log line: a closed task holding a lease would
    // sit in the sweep's way for nothing.
    await releaseLease(args.taskId, ctx.actor.agentId);

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.completed',
      entityType: 'task',
      entityId: args.taskId,
      meta: { title: task.title, runId: open[0]?.id ?? null, via: 'mcp' },
    });

    return {
      task: taskBrief(updated.task),
      // A recurring task rolls forward instead of closing; say so rather than
      // letting the agent think its "done" did not stick.
      recurrenceAdvanced: updated.recurrenceAdvanced,
    };
  },
};

const failTaskArgs = z.object({
  taskId: uuid,
  error: z.string().trim().min(1, 'Di qué ha fallado').max(20_000),
});

const failTaskTool: ToolDefinition = {
  name: 'fail_task',
  description:
    'Abandona la tarea diciendo por qué: cierra el run como failed, suelta el lease, deja el motivo ' +
    'como comentario y pasa la tarea a review para que la mire una persona. ' +
    'No la devuelve a la cola: un fallo que se reintenta solo es un bucle.',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' }, error: { type: 'string' } },
    required: ['taskId', 'error'],
    additionalProperties: false,
  },
  schema: failTaskArgs,
  gatedAs: 'fail_task',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(failTaskArgs, raw);
    const task = await loadTask(args.taskId);

    const decision = await gateOrPark(ctx, 'fail_task', task, {
      title: `Dar por fallida «${task.title}»`,
      payload: { taskId: args.taskId, error: args.error },
    });
    if (decision.parked) return parkedResult(decision.parked);

    requireLease(task, ctx.actor);

    const open = await listRuns({
      agentId: ctx.actor.agentId,
      taskId: args.taskId,
      statuses: ['queued', 'running'],
      limit: 1,
    });
    if (open[0]) await updateRun(open[0].id, { status: 'failed', error: args.error });

    await addTaskComment(
      args.taskId,
      agentActivityActor(ctx.actor),
      `No he podido terminarla: ${args.error}`,
    );

    const updated = await updateTask(args.taskId, { status: 'review' });
    await releaseLease(args.taskId, ctx.actor.agentId);

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.failed',
      entityType: 'task',
      entityId: args.taskId,
      meta: { title: task.title, error: args.error, runId: open[0]?.id ?? null, via: 'mcp' },
    });

    return { task: updated ? taskBrief(updated.task) : null, status: 'review' };
  },
};

export const FLOW_TOOLS: ToolDefinition[] = [
  listTasksTool,
  getNextTaskTool,
  getTaskTool,
  claimTaskTool,
  updateTaskStatusTool,
  addCommentTool,
  appendLogTool,
  attachArtifactTool,
  createSubtaskTool,
  proposeDelegationTool,
  requestApprovalTool,
  completeTaskTool,
  failTaskTool,
];

export { requireScope };
