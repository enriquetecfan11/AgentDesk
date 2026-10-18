import 'server-only';

import { z } from 'zod';

import { agentActivityActor } from '@/lib/auth/agent';
import { logActivity } from '@/lib/domain/activity';
import { getAgent } from '@/lib/domain/agents';
import { addTaskComment } from '@/lib/domain/comments';
import { renewLease } from '@/lib/domain/claims';
import {
  getDelegation,
  getQueue,
  listDelegations,
  updateDelegationStatus,
} from '@/lib/domain/delegations';
import { createNote, DuplicateNoteTitleError, getNote, listNotes, updateNote } from '@/lib/domain/notes';
import { listProjects } from '@/lib/domain/projects';
import { createArtifact, createRun, appendRunLogs, updateRun } from '@/lib/domain/runs';
import { createTask, updateTask } from '@/lib/domain/tasks';
import {
  gateOrPark,
  loadTask,
  parkedResult,
  parseArgs,
  taskBrief,
  ToolError,
  type ToolContext,
  type ToolDefinition,
} from '@/lib/mcp/shared';
import {
  artifactCreateSchema,
  noteCreateSchema,
  noteUpdateSchema,
  runCreateSchema,
  runUpdateSchema,
  taskCreateSchema,
  taskUpdateSchema,
} from '@/lib/validation';

/**
 * The workspace tools that existed before the approval flow.
 *
 * They are kept, name for name and shape for shape, so every MCP client that
 * works today keeps working: moving the server into the app was supposed to
 * change where it runs, not what it does.
 *
 * Two of them do change, and only in one direction — `create_task` and
 * `update_task` now go through the gate, mapped onto the policy entry for the
 * equivalent flow tool. Without that, `update_task` would be a way to set a
 * status on a `suggest_only` task that `update_task_status` refuses, and a
 * gate with a way around it is decoration. The read-only and narration tools
 * (`whoami`, `get_queue`, the notes, the runs, the logs) stay ungated: they
 * could not change the work before and still cannot.
 */

const uuid = z.uuid();
const empty = z.object({}).loose();

const whoamiTool: ToolDefinition = {
  name: 'whoami',
  description: 'Quién eres, qué scopes tiene tu token y cuánto trabajo tienes esperando.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  schema: empty,
  gatedAs: null,
  // Deliberately scopeless, like `GET /api/v1/me`: a badly configured token
  // has to be able to find out what is wrong with it.
  scope: 'tasks:read',
  run: async (ctx: ToolContext) => {
    const [agent, queue] = await Promise.all([
      getAgent(ctx.actor.agentId),
      getQueue(ctx.actor.agentId),
    ]);

    return {
      agent: {
        id: ctx.actor.agentId,
        name: ctx.actor.agentName,
        status: ctx.actor.agentStatus,
        capabilities: agent?.capabilities ?? [],
      },
      scopes: ctx.actor.scopes,
      queue: { delegations: queue?.delegations.length ?? 0, tasks: queue?.tasks.length ?? 0 },
      serverTime: new Date().toISOString(),
    };
  },
};

const getQueueTool: ToolDefinition = {
  name: 'get_queue',
  description:
    'Tu cola: delegaciones que puedes empezar y tareas asignadas que siguen abiertas. ' +
    'No incluye tareas con el lease vivo de otro agente.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  schema: empty,
  gatedAs: null,
  scope: 'delegations:read',
  run: async (ctx: ToolContext) => {
    const queue = await getQueue(ctx.actor.agentId);
    if (!queue) throw new ToolError('No se encuentra el agente del token');

    return {
      delegations: queue.delegations.map((delegation) => ({
        id: delegation.id,
        title: delegation.title,
        status: delegation.status,
        instructions: delegation.instructions,
        taskId: delegation.taskId,
      })),
      tasks: queue.tasks.map(taskBrief),
    };
  },
};

const createTaskTool: ToolDefinition = {
  name: 'create_task',
  description:
    'Crea una tarea. Se te asigna a ti si no dices otra cosa. Con parentTaskId crea una subtarea, ' +
    'y entonces hereda la autonomía de la tarea padre y pasa por su mismo filtro.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      status: {
        type: 'string',
        enum: ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'],
      },
      priority: { type: 'string', enum: ['none', 'low', 'normal', 'high', 'urgent'] },
      projectId: { type: 'string' },
      parentTaskId: { type: 'string' },
      dueDate: { type: 'string', description: 'YYYY-MM-DD' },
      dueTime: { type: 'string', description: 'HH:MM' },
      recurrence: { type: 'string', description: 'p. ej. FREQ=WEEKLY;BYDAY=MO' },
      autonomy: {
        type: 'string',
        enum: ['suggest_only', 'do_with_approval', 'autonomous_low_risk'],
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  schema: taskCreateSchema,
  gatedAs: 'create_subtask',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const input = parseArgs(taskCreateSchema, raw);

    // A subtask answers to its parent's leash. A brand-new root task has no
    // parent to ask, so it is created and the gate applies from then on.
    if (input.parentTaskId) {
      const parent = await loadTask(input.parentTaskId);
      const decision = await gateOrPark(ctx, 'create_subtask', parent, {
        title: `Crear la subtarea «${input.title}»`,
        payload: { ...input },
      });
      if (decision.parked) return parkedResult(decision.parked);

      const subtask = await createTask({
        ...input,
        assigneeType: input.assigneeType ?? 'agent',
        assigneeId: input.assigneeId ?? ctx.actor.agentId,
        autonomy: input.autonomy ?? parent.autonomy,
      });

      await logActivity({
        actor: agentActivityActor(ctx.actor),
        action: 'task.created',
        entityType: 'task',
        entityId: subtask.id,
        meta: { title: subtask.title, parentTaskId: parent.id, notice: decision.notice, via: 'mcp' },
      });

      return { task: taskBrief(subtask), notice: decision.notice };
    }

    const task = await createTask({
      ...input,
      assigneeType: input.assigneeType ?? 'agent',
      assigneeId: input.assigneeId ?? ctx.actor.agentId,
    });

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.created',
      entityType: 'task',
      entityId: task.id,
      meta: { title: task.title, status: task.status, via: 'mcp' },
    });

    return { task: taskBrief(task) };
  },
};

const updateTaskArgs = taskUpdateSchema.extend({ taskId: uuid });

const updateTaskTool: ToolDefinition = {
  name: 'update_task',
  description:
    'Modifica una tarea. Pasa por el mismo filtro que update_task_status, así que en una tarea ' +
    'en suggest_only se queda esperando aprobación en lugar de aplicarse.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: {
        type: 'string',
        enum: ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled'],
      },
      priority: { type: 'string', enum: ['none', 'low', 'normal', 'high', 'urgent'] },
      projectId: { type: 'string' },
      dueDate: { type: 'string' },
      dueTime: { type: 'string' },
      recurrence: { type: 'string' },
      autonomy: {
        type: 'string',
        enum: ['suggest_only', 'do_with_approval', 'autonomous_low_risk'],
      },
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  schema: updateTaskArgs,
  gatedAs: 'update_task_status',
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const { taskId, ...patch } = parseArgs(updateTaskArgs, raw);
    const task = await loadTask(taskId);

    const decision = await gateOrPark(ctx, 'update_task_status', task, {
      tool: 'update_task',
      title: `Modificar «${task.title}»`,
      payload: { taskId, ...patch },
    });
    if (decision.parked) return parkedResult(decision.parked);

    const updated = await updateTask(taskId, patch);
    if (!updated) throw new ToolError(`No existe la tarea ${taskId}`);

    await renewLease(taskId, ctx.actor.agentId);
    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'task.updated',
      entityType: 'task',
      entityId: taskId,
      meta: { via: 'mcp' },
    });

    return { task: taskBrief(updated.task), recurrenceAdvanced: updated.recurrenceAdvanced };
  },
};

const commentTaskArgs = z.object({
  taskId: uuid,
  body: z.string().trim().min(1).max(20_000),
});

const commentTaskTool: ToolDefinition = {
  name: 'comment_task',
  description: 'Comenta en una tarea. El nombre anterior de add_comment; hace lo mismo.',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' }, body: { type: 'string' } },
    required: ['taskId', 'body'],
    additionalProperties: false,
  },
  schema: commentTaskArgs,
  gatedAs: null,
  scope: 'tasks:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(commentTaskArgs, raw);
    await loadTask(args.taskId);

    const comment = await addTaskComment(args.taskId, agentActivityActor(ctx.actor), args.body);
    await renewLease(args.taskId, ctx.actor.agentId);

    return { comment: { id: comment.id, at: comment.createdAt } };
  },
};

const listProjectsTool: ToolDefinition = {
  name: 'list_projects',
  description: 'Los proyectos del workspace.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  schema: empty,
  gatedAs: null,
  scope: 'projects:read',
  run: async () => {
    const projects = await listProjects();
    return {
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        status: project.status,
        taskTotal: project.taskTotal,
        taskDone: project.taskDone,
      })),
    };
  },
};

const listNotesArgs = z.object({
  q: z.string().trim().max(200).optional(),
  projectId: uuid.optional(),
});

const listNotesTool: ToolDefinition = {
  name: 'list_notes',
  description: 'Lista notas, con un extracto de cada una. Filtros: q, projectId.',
  inputSchema: {
    type: 'object',
    properties: { q: { type: 'string' }, projectId: { type: 'string' } },
    additionalProperties: false,
  },
  schema: listNotesArgs,
  gatedAs: null,
  scope: 'notes:read',
  run: async (_ctx: ToolContext, raw) => {
    const args = parseArgs(listNotesArgs, raw);
    return { notes: await listNotes({ search: args.q, projectId: args.projectId }) };
  },
};

const getNoteArgs = z.object({ noteId: uuid });

const getNoteTool: ToolDefinition = {
  name: 'get_note',
  description: 'Una nota completa, con sus backlinks y sus enlaces salientes.',
  inputSchema: {
    type: 'object',
    properties: { noteId: { type: 'string' } },
    required: ['noteId'],
    additionalProperties: false,
  },
  schema: getNoteArgs,
  gatedAs: null,
  scope: 'notes:read',
  run: async (_ctx: ToolContext, raw) => {
    const { noteId } = parseArgs(getNoteArgs, raw);
    const note = await getNote(noteId);
    if (!note) throw new ToolError(`No existe la nota ${noteId}`);
    return note;
  },
};

const createNoteTool: ToolDefinition = {
  name: 'create_note',
  description: 'Crea una nota en Markdown. Los [[enlaces]] se resuelven al guardarla.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      contentMd: { type: 'string' },
      projectId: { type: 'string' },
      taskId: { type: 'string' },
    },
    required: ['title'],
    additionalProperties: false,
  },
  schema: noteCreateSchema,
  gatedAs: null,
  scope: 'notes:write',
  run: async (ctx: ToolContext, raw) => {
    const input = parseArgs(noteCreateSchema, raw);

    try {
      const note = await createNote(input);
      await logActivity({
        actor: agentActivityActor(ctx.actor),
        action: 'note.created',
        entityType: 'note',
        entityId: note.note.id,
        meta: { title: note.note.title, via: 'mcp' },
      });
      return { note: note.note };
    } catch (error) {
      if (error instanceof DuplicateNoteTitleError) throw new ToolError(error.message);
      throw error;
    }
  },
};

const updateNoteArgs = noteUpdateSchema.extend({ noteId: uuid });

const updateNoteTool: ToolDefinition = {
  name: 'update_note',
  description: 'Edita una nota. El grafo de enlaces se reconstruye solo.',
  inputSchema: {
    type: 'object',
    properties: {
      noteId: { type: 'string' },
      title: { type: 'string' },
      contentMd: { type: 'string' },
      projectId: { type: 'string' },
      taskId: { type: 'string' },
    },
    required: ['noteId'],
    additionalProperties: false,
  },
  schema: updateNoteArgs,
  gatedAs: null,
  scope: 'notes:write',
  run: async (ctx: ToolContext, raw) => {
    const { noteId, ...patch } = parseArgs(updateNoteArgs, raw);

    try {
      const note = await updateNote(noteId, patch);
      if (!note) throw new ToolError(`No existe la nota ${noteId}`);

      await logActivity({
        actor: agentActivityActor(ctx.actor),
        action: 'note.updated',
        entityType: 'note',
        entityId: noteId,
        meta: { title: note.note.title, via: 'mcp' },
      });
      return { note: note.note };
    } catch (error) {
      if (error instanceof DuplicateNoteTitleError) throw new ToolError(error.message);
      throw error;
    }
  },
};

const DELEGATION_STATUS_VALUES = [
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'failed',
  'rejected',
  'cancelled',
] as const;

const listDelegationsArgs = z.object({ status: z.string().trim().max(120).optional() });

const listDelegationsTool: ToolDefinition = {
  name: 'list_delegations',
  description: 'Tus delegaciones. Filtro opcional: status (coma-separado).',
  inputSchema: {
    type: 'object',
    properties: { status: { type: 'string' } },
    additionalProperties: false,
  },
  schema: listDelegationsArgs,
  gatedAs: null,
  scope: 'delegations:read',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(listDelegationsArgs, raw);
    const statuses = args.status
      ?.split(',')
      .map((value) => value.trim())
      .filter((value): value is (typeof DELEGATION_STATUS_VALUES)[number] =>
        (DELEGATION_STATUS_VALUES as readonly string[]).includes(value),
      );

    return {
      delegations: await listDelegations({
        agentId: ctx.actor.agentId,
        statuses: statuses?.length ? statuses : undefined,
      }),
    };
  },
};

const updateDelegationArgs = z.object({
  delegationId: uuid,
  status: z.enum(DELEGATION_STATUS_VALUES),
  note: z.string().trim().max(4000).optional(),
});

const updateDelegationTool: ToolDefinition = {
  name: 'update_delegation',
  description:
    'Mueve una de tus delegaciones. El campo note queda como comentario en la tarea asociada. ' +
    'Solo puedes tocar las tuyas.',
  inputSchema: {
    type: 'object',
    properties: {
      delegationId: { type: 'string' },
      status: { type: 'string', enum: [...DELEGATION_STATUS_VALUES] },
      note: { type: 'string' },
    },
    required: ['delegationId', 'status'],
    additionalProperties: false,
  },
  schema: updateDelegationArgs,
  gatedAs: null,
  scope: 'delegations:write',
  run: async (ctx: ToolContext, raw) => {
    const args = parseArgs(updateDelegationArgs, raw);

    const current = await getDelegation(args.delegationId);
    if (!current) throw new ToolError(`No existe la delegación ${args.delegationId}`);
    if (current.toAgentId !== ctx.actor.agentId) {
      throw new ToolError('Esa delegación no es tuya');
    }

    const delegation = await updateDelegationStatus(args.delegationId, { status: args.status });
    if (!delegation) throw new ToolError(`No existe la delegación ${args.delegationId}`);

    if (args.note && delegation.taskId) {
      await addTaskComment(delegation.taskId, agentActivityActor(ctx.actor), args.note);
    }

    await logActivity({
      actor: agentActivityActor(ctx.actor),
      action: 'delegation.updated',
      entityType: 'delegation',
      entityId: args.delegationId,
      meta: { status: args.status, via: 'mcp' },
    });

    return { delegation };
  },
};

const startRunTool: ToolDefinition = {
  name: 'start_run',
  description:
    'Abre un run. Si venía de una delegación, la pone en curso. Para el flujo nuevo no suele hacer ' +
    'falta: append_log abre y reutiliza el run de la tarea por su cuenta.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      delegationId: { type: 'string' },
      status: { type: 'string', enum: ['queued', 'running'] },
      input: { type: 'object' },
    },
    additionalProperties: false,
  },
  schema: runCreateSchema,
  gatedAs: null,
  scope: 'runs:write',
  run: async (ctx: ToolContext, raw) => {
    const input = parseArgs(runCreateSchema, raw);
    const run = await createRun({ ...input, agentId: ctx.actor.agentId });
    return { run: { id: run.id, status: run.status } };
  },
};

const logRunArgs = z.object({
  runId: uuid,
  message: z.string().trim().min(1).max(20_000).optional(),
  level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  logs: z
    .array(
      z.object({
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
        message: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(500)
    .optional(),
});

const logRunTool: ToolDefinition = {
  name: 'log_run',
  description: 'Escribe en un run: una línea con message, o varias con logs.',
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string' },
      message: { type: 'string' },
      level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
      logs: { type: 'array', items: { type: 'object' } },
    },
    required: ['runId'],
    additionalProperties: false,
  },
  schema: logRunArgs,
  gatedAs: null,
  scope: 'runs:write',
  run: async (_ctx: ToolContext, raw) => {
    const args = parseArgs(logRunArgs, raw);

    const lines =
      args.logs ??
      (args.message ? [{ level: args.level ?? 'info', message: args.message }] : null);
    if (!lines) throw new ToolError('Manda message o logs');

    const written = await appendRunLogs(args.runId, lines);
    if (written.length === 0) throw new ToolError(`No existe el run ${args.runId}`);

    return { written: written.length };
  },
};

const finishRunArgs = runUpdateSchema.extend({ runId: uuid });

const finishRunTool: ToolDefinition = {
  name: 'finish_run',
  description:
    'Cierra un run con su resultado. Los tiempos los pone el servidor. Si venía de una delegación, ' +
    'la cierra con él.',
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string' },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
      },
      output: { type: 'string' },
      error: { type: 'string' },
      costUsd: { type: 'number' },
    },
    required: ['runId'],
    additionalProperties: false,
  },
  schema: finishRunArgs,
  gatedAs: null,
  scope: 'runs:write',
  run: async (_ctx: ToolContext, raw) => {
    const { runId, ...patch } = parseArgs(finishRunArgs, raw);
    const run = await updateRun(runId, patch);
    if (!run) throw new ToolError(`No existe el run ${runId}`);
    return { run: { id: run.id, status: run.status, durationMs: run.durationMs } };
  },
};

const addArtifactTool: ToolDefinition = {
  name: 'add_artifact',
  description: 'El nombre anterior de attach_artifact; hace lo mismo.',
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
  schema: artifactCreateSchema,
  gatedAs: null,
  scope: 'runs:write',
  run: async (_ctx: ToolContext, raw) => {
    const input = parseArgs(artifactCreateSchema, raw);
    const artifact = await createArtifact(input);
    return { artifact: { id: artifact.id, name: artifact.name, kind: artifact.kind } };
  },
};

export const WORKSPACE_TOOLS: ToolDefinition[] = [
  whoamiTool,
  getQueueTool,
  createTaskTool,
  updateTaskTool,
  commentTaskTool,
  listProjectsTool,
  listNotesTool,
  getNoteTool,
  createNoteTool,
  updateNoteTool,
  listDelegationsTool,
  updateDelegationTool,
  startRunTool,
  logRunTool,
  finishRunTool,
  addArtifactTool,
];
