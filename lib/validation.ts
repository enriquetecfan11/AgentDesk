import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/constants';
import { parseRecurrence } from '@/lib/recurrence';

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

export { taskStatusSchema as taskStatus, taskPrioritySchema as taskPriority };
