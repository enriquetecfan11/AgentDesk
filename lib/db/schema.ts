import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const taskStatusEnum = pgEnum('task_status', [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
]);

export const taskPriorityEnum = pgEnum('task_priority', [
  'none',
  'low',
  'normal',
  'high',
  'urgent',
]);

export const assigneeTypeEnum = pgEnum('assignee_type', ['human', 'agent']);

export const actorTypeEnum = pgEnum('actor_type', ['human', 'agent', 'system']);

export const projectStatusEnum = pgEnum('project_status', [
  'active',
  'paused',
  'completed',
  'archived',
]);

export const agentStatusEnum = pgEnum('agent_status', ['active', 'paused', 'archived']);

export const delegationStatusEnum = pgEnum('delegation_status', [
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'failed',
  'rejected',
  'cancelled',
]);

export const runStatusEnum = pgEnum('run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const runLogLevelEnum = pgEnum('run_log_level', ['debug', 'info', 'warn', 'error']);

export const artifactKindEnum = pgEnum('artifact_kind', ['file', 'text', 'url']);

export const noteSourceEnum = pgEnum('note_source', ['app', 'obsidian']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Identity: users + sessions (see lib/auth)
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Stored already lowercased by the application so a plain unique index
    // is enough (no functional index needed).
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt,
    updatedAt,
  },
  (t) => [uniqueIndex('users_email_unique').on(t.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Only sha256(token) is stored; the raw token lives only in the cookie.
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Work: projects, labels, tasks
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Short uppercase code used for human-readable task ids, e.g. WAZ.
    identifier: text('identifier'),
    name: text('name').notNull(),
    description: text('description'),
    status: projectStatusEnum('status').notNull().default('active'),
    color: text('color'),
    // Lightweight milestones: [{ title, done, date }]
    milestones: jsonb('milestones').notNull().default([]),
    targetDate: date('target_date'),
    sortOrder: real('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('projects_status_idx').on(t.status),
    uniqueIndex('projects_identifier_unique').on(t.identifier),
  ],
);

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt,
  },
  (t) => [uniqueIndex('labels_name_unique').on(t.name)],
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('todo'),
    priority: taskPriorityEnum('priority').notNull().default('none'),

    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, {
      onDelete: 'cascade',
    }),

    // Polymorphic assignee: "human" points at users.id, "agent" at agents.id.
    // No FK is possible across two tables, so referential integrity for
    // agent assignees is enforced in the domain layer.
    assigneeType: assigneeTypeEnum('assignee_type'),
    assigneeId: uuid('assignee_id'),

    dueDate: date('due_date'),
    dueTime: time('due_time'),
    // Simple RRULE fragment, e.g. "FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO".
    recurrence: text('recurrence'),

    sortOrder: real('sort_order').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('tasks_status_idx').on(t.status),
    index('tasks_project_idx').on(t.projectId),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_due_date_idx').on(t.dueDate),
    index('tasks_assignee_idx').on(t.assigneeType, t.assigneeId),
  ],
);

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index('task_labels_label_idx').on(t.labelId),
  ],
);

// ---------------------------------------------------------------------------
// Notes (markdown) + wiki links
// ---------------------------------------------------------------------------

export const notes = pgTable(
  'notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    contentMd: text('content_md').notNull().default(''),
    source: noteSourceEnum('source').notNull().default('app'),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('notes_project_idx').on(t.projectId),
    index('notes_task_idx').on(t.taskId),
    uniqueIndex('notes_title_unique').on(t.title),
  ],
);

// Resolved [[wiki links]] between notes, rebuilt whenever a note is saved.
export const noteLinks = pgTable(
  'note_links',
  {
    fromNoteId: uuid('from_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    toNoteId: uuid('to_note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.fromNoteId, t.toNoteId] }),
    index('note_links_to_idx').on(t.toNoteId),
  ],
);

// ---------------------------------------------------------------------------
// Agents, delegations, runs
// ---------------------------------------------------------------------------

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  capabilities: text('capabilities').array().notNull().default([]),
  status: agentStatusEnum('status').notNull().default('active'),
  createdAt,
  updatedAt,
});

export const delegations = pgTable(
  'delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromType: actorTypeEnum('from_type').notNull().default('human'),
    fromId: uuid('from_id'),
    toAgentId: uuid('to_agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    instructions: text('instructions'),
    status: delegationStatusEnum('status').notNull().default('pending'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('delegations_agent_idx').on(t.toAgentId),
    index('delegations_status_idx').on(t.status),
    index('delegations_task_idx').on(t.taskId),
  ],
);

export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    delegationId: uuid('delegation_id').references(() => delegations.id, {
      onDelete: 'set null',
    }),
    status: runStatusEnum('status').notNull().default('queued'),
    input: jsonb('input'),
    output: text('output'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    createdAt,
    updatedAt,
  },
  (t) => [
    index('runs_agent_idx').on(t.agentId),
    index('runs_task_idx').on(t.taskId),
    index('runs_status_idx').on(t.status),
  ],
);

export const runLogs = pgTable(
  'run_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    level: runLogLevelEnum('level').notNull().default('info'),
    message: text('message').notNull(),
    createdAt,
  },
  (t) => [index('run_logs_run_idx').on(t.runId, t.createdAt)],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    kind: artifactKindEnum('kind').notNull().default('file'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    // Relative path under UPLOADS_DIR. Null for kind = 'text'.
    storagePath: text('storage_path'),
    content: text('content'),
    createdAt,
  },
  (t) => [
    index('artifacts_run_idx').on(t.runId),
    index('artifacts_task_idx').on(t.taskId),
  ],
);

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  context: text('context'),
  resolution: text('resolution'),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdAt,
});

// ---------------------------------------------------------------------------
// Agent credentials
// ---------------------------------------------------------------------------

export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('default'),
    // First characters of the raw token, for display only ("agt_1a2b3c4d").
    tokenPrefix: text('token_prefix').notNull(),
    // sha256(raw token). The raw token is shown once and never stored.
    tokenHash: text('token_hash').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    uniqueIndex('api_tokens_hash_unique').on(t.tokenHash),
    index('api_tokens_agent_idx').on(t.agentId),
  ],
);

// ---------------------------------------------------------------------------
// Activity feed, saved views, outgoing webhooks
// ---------------------------------------------------------------------------

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorType: actorTypeEnum('actor_type').notNull().default('human'),
    actorId: uuid('actor_id'),
    // Denormalised label so the timeline survives actor deletion.
    actorName: text('actor_name').notNull().default('system'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    meta: jsonb('meta'),
    createdAt,
  },
  (t) => [index('activity_log_created_idx').on(t.createdAt)],
);

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // e.g. "tasks" | "board" | "calendar"
    kind: text('kind').notNull().default('tasks'),
    params: jsonb('params').notNull().default({}),
    createdAt,
  },
  (t) => [index('saved_views_user_idx').on(t.userId)],
);

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  // Subscriptions: an event name, `area.*` or `*`.
  events: text('events').array().notNull().default([]),
  // Shared secret for the HMAC-SHA256 signature header. Stored in clear text:
  // signing needs the original value and the receiver holds the same secret.
  secret: text('secret').notNull(),
  active: boolean('active').notNull().default(true),
  // Result of the last delivery. Enough to answer "is this endpoint alive?"
  // from the settings screen without keeping a delivery log table.
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastStatus: integer('last_status'),
  lastError: text('last_error'),
  deliveryCount: integer('delivery_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt,
  updatedAt,
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Label = typeof labels.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskStatus = Task['status'];
export type TaskPriority = Task['priority'];

export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Delegation = typeof delegations.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunLog = typeof runLogs.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type ActivityEntry = typeof activityLog.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
