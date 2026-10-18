import { z } from 'zod';

import { isAgentScope } from '@/lib/agent-token';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/constants';
import { parseRecurrence } from '@/lib/recurrence';
import { isWebhookPattern } from '@/lib/webhook';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'Introduce un email válido',
  });

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .max(PASSWORD_MAX_LENGTH, `La contraseña no puede superar ${PASSWORD_MAX_LENGTH} caracteres`);

export const setupSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(100),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'La contraseña es obligatoria').max(PASSWORD_MAX_LENGTH),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projectStatusSchema = z.enum(['active', 'paused', 'completed', 'archived']);
export const taskStatusSchema = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
]);
export const taskPrioritySchema = z.enum(['none', 'low', 'normal', 'high', 'urgent']);

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  identifier: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(6)
    .regex(/^[A-Z0-9]+$/, 'Solo letras y números')
    .nullish(),
  description: z.string().trim().max(5000).nullish(),
  status: projectStatusSchema.default('active'),
  color: z.string().trim().max(32).nullish(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD')
    .nullish(),
});

export const milestoneSchema = z.object({
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
});

export const projectUpdateSchema = projectCreateSchema.partial().extend({
  milestones: z.array(milestoneSchema).max(50).nullish(),
});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD')
  .nullish();

const timeOfDay = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Formato esperado: HH:MM')
  .nullish();

/**
 * Stored as an RRULE fragment. Anything the engine cannot execute is rejected
 * here rather than silently ignored when the task is completed.
 */
const recurrence = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => parseRecurrence(value) !== null, {
    message: 'Regla de recurrencia no válida',
  })
  .nullish();

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(500),
  description: z.string().max(20000).nullish(),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default('none'),
  projectId: z.uuid().nullish(),
  parentTaskId: z.uuid().nullish(),
  assigneeType: z.enum(['human', 'agent']).nullish(),
  assigneeId: z.uuid().nullish(),
  dueDate: dateOnly,
  dueTime: timeOfDay,
  recurrence,
  labelIds: z.array(z.uuid()).max(20).optional(),
});

export const taskUpdateSchema = taskCreateSchema.partial().omit({ labelIds: true }).extend({
  sortOrder: z.number().optional(),
});

export const taskMoveSchema = z.object({
  status: taskStatusSchema,
  sortOrder: z.number(),
});

export const taskLabelsSchema = z.object({
  labelIds: z.array(z.uuid()).max(20),
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z.string().trim().max(32).nullish(),
});

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------

export const captureSchema = z.object({
  text: z.string().trim().min(1, 'Escribe algo que capturar').max(2000),
  /** Used only when the text itself has no `#project`. */
  projectId: z.uuid().nullish(),
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const NOTE_CONTENT_MAX = 200_000;

export const noteCreateSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  contentMd: z.string().max(NOTE_CONTENT_MAX).default(''),
  projectId: z.uuid().nullish(),
  taskId: z.uuid().nullish(),
});

export const noteUpdateSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(200).optional(),
  contentMd: z.string().max(NOTE_CONTENT_MAX).optional(),
  projectId: z.uuid().nullish(),
  taskId: z.uuid().nullish(),
});

/**
 * Import of a whole vault at once.
 *
 * The files travel as JSON rather than as a ZIP: the browser can read a
 * multi-file selection with `FileReader` and the server stays free of an
 * unzip implementation and of the decompression-bomb surface that comes
 * with it.
 */
export const noteImportSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        content: z.string().max(NOTE_CONTENT_MAX),
      }),
    )
    .min(1, 'Selecciona al menos un archivo .md')
    .max(1000),
  /** Existing notes with the same title are overwritten instead of skipped. */
  overwrite: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agentCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  description: z.string().trim().max(2000).nullish(),
  capabilities: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  status: z.enum(['active', 'paused', 'archived']).default('active'),
});

export const agentUpdateSchema = agentCreateSchema.partial();

/** `null` means "never expires". */
const expiresAt = z.iso.datetime({ offset: true }).nullish();

export const tokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80).default('default'),
  scopes: z
    .array(z.string().trim().min(1).max(40))
    .min(1, 'Elige al menos un scope')
    .max(40)
    .refine((values) => values.every((value) => isAgentScope(value) || value === '*'), {
      message: 'Hay un scope desconocido',
    }),
  expiresAt,
});

// ---------------------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------------------

export const delegationCreateSchema = z.object({
  toAgentId: z.uuid(),
  title: z.string().trim().min(1, 'El título es obligatorio').max(300),
  instructions: z.string().trim().max(20000).nullish(),
  taskId: z.uuid().nullish(),
  requiresApproval: z.boolean().default(false),
});

export const delegationUpdateSchema = z.object({
  status: z.enum([
    'pending',
    'accepted',
    'in_progress',
    'completed',
    'failed',
    'rejected',
    'cancelled',
  ]),
  /** Appended to the delegation as an activity entry. */
  note: z.string().trim().max(4000).nullish(),
});

/** The human side only approves or cancels; doing the work is the agent's job. */
export const delegationReviewSchema = z.object({
  action: z.enum(['approve', 'cancel']),
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export const runCreateSchema = z.object({
  agentId: z.uuid().nullish(),
  taskId: z.uuid().nullish(),
  delegationId: z.uuid().nullish(),
  input: z.unknown().nullish(),
  status: z.enum(['queued', 'running']).default('queued'),
});

export const runUpdateSchema = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  output: z.string().max(200_000).nullish(),
  error: z.string().max(20000).nullish(),
  costUsd: z.number().min(0).max(100_000).nullish(),
  input: z.unknown().nullish(),
});

export const runLogCreateSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  message: z.string().min(1).max(20_000),
});

/** Logs are usually sent in bursts, so the endpoint also takes a batch. */
export const runLogBatchSchema = z.object({
  logs: z.array(runLogCreateSchema).min(1).max(500),
});

const ARTIFACT_MAX_BASE64 = 8_000_000;

export const artifactCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    kind: z.enum(['file', 'text', 'url']).default('text'),
    mimeType: z.string().trim().max(120).nullish(),
    /** Inline body for `kind = 'text'` or `kind = 'url'`. */
    content: z.string().max(200_000).nullish(),
    /** Base64 body for `kind = 'file'`. */
    contentBase64: z.string().max(ARTIFACT_MAX_BASE64).nullish(),
    runId: z.uuid().nullish(),
    taskId: z.uuid().nullish(),
  })
  .refine(
    (value) => value.kind !== 'file' || Boolean(value.contentBase64),
    { message: 'Un artefacto de tipo file necesita contentBase64', path: ['contentBase64'] },
  )
  .refine((value) => value.kind !== 'text' || value.content !== undefined, {
    message: 'Un artefacto de tipo text necesita content',
    path: ['content'],
  });

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const commentCreateSchema = z.object({
  body: z.string().trim().min(1, 'El comentario no puede estar vacío').max(20_000),
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

const webhookUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => /^https?:\/\/[^\s]+$/i.test(value), {
    message: 'La URL debe empezar por http:// o https://',
  });

export const webhookCreateSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
  url: webhookUrl,
  events: z
    .array(z.string().trim().min(1).max(60))
    .min(1, 'Suscríbete al menos a un evento')
    .max(20)
    .refine((values) => values.every((value) => isWebhookPattern(value)), {
      message: 'Hay un evento desconocido',
    }),
  active: z.boolean().default(true),
});

export const webhookUpdateSchema = webhookCreateSchema.partial().extend({
  /** Issues a new secret and invalidates the one the receiver knows. */
  rotateSecret: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Inferred input types
// ---------------------------------------------------------------------------

export type SetupInput = z.infer<typeof setupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type LabelCreateInput = z.infer<typeof labelCreateSchema>;
export type CaptureInput = z.infer<typeof captureSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
export type NoteImportInput = z.infer<typeof noteImportSchema>;
export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;
export type TokenCreateInput = z.infer<typeof tokenCreateSchema>;
export type DelegationCreateInput = z.infer<typeof delegationCreateSchema>;
export type DelegationUpdateInput = z.infer<typeof delegationUpdateSchema>;
export type RunCreateInput = z.infer<typeof runCreateSchema>;
export type RunUpdateInput = z.infer<typeof runUpdateSchema>;
export type RunLogCreateInput = z.infer<typeof runLogCreateSchema>;
export type ArtifactCreateInput = z.infer<typeof artifactCreateSchema>;
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;

export { taskStatusSchema as taskStatus, taskPrioritySchema as taskPriority };
