import 'server-only';

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import {
  labels,
  projects,
  taskLabels,
  tasks,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/db/schema';
import { todayIso } from '@/lib/dates';
import { serializeTask } from '@/lib/domain/serialize';
import { firstOccurrence, nextOccurrence, parseRecurrence } from '@/lib/recurrence';
import { emitEvent } from '@/lib/domain/events';
import type { LabelRef, ProjectRef, TaskDTO } from '@/lib/types';
import type { TaskCreateInput, TaskUpdateInput } from '@/lib/validation';

export type TaskFilters = {
  projectId?: string;
  statuses?: TaskStatus[];
  priorities?: TaskPriority[];
  assigneeType?: 'human' | 'agent';
  assigneeId?: string;
  /** Only top-level tasks (excludes subtasks). */
  rootOnly?: boolean;
  parentTaskId?: string;
  dueDate?: string;
  dueOnOrBefore?: string;
  dueOnOrAfter?: string;
  /** Tasks with no project and no due date — the Todoist-style Inbox. */
  inboxOnly?: boolean;
  search?: string;
  limit?: number;
  orderBy?: 'manual' | 'dueDate' | 'created' | 'priority';
};

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
  none: 4,
};

/**
 * Core task query. Labels and subtask counters are fetched in two extra
 * round-trips and merged in memory: a personal workspace holds thousands, not
 * millions, of rows, and this keeps the SQL readable.
 */
export async function listTasks(filters: TaskFilters = {}): Promise<TaskDTO[]> {
  const conditions = [];

  if (filters.projectId) conditions.push(eq(tasks.projectId, filters.projectId));
  if (filters.statuses?.length) conditions.push(inArray(tasks.status, filters.statuses));
  if (filters.priorities?.length) conditions.push(inArray(tasks.priority, filters.priorities));
  if (filters.assigneeType) conditions.push(eq(tasks.assigneeType, filters.assigneeType));
  if (filters.assigneeId) conditions.push(eq(tasks.assigneeId, filters.assigneeId));
  if (filters.parentTaskId) conditions.push(eq(tasks.parentTaskId, filters.parentTaskId));
  if (filters.rootOnly) conditions.push(isNull(tasks.parentTaskId));
  if (filters.dueDate) conditions.push(eq(tasks.dueDate, filters.dueDate));
  if (filters.dueOnOrBefore) conditions.push(lte(tasks.dueDate, filters.dueOnOrBefore));
  if (filters.dueOnOrAfter) conditions.push(gte(tasks.dueDate, filters.dueOnOrAfter));
  if (filters.search) conditions.push(ilike(tasks.title, `%${filters.search}%`));
  if (filters.inboxOnly) {
    conditions.push(isNull(tasks.projectId));
    conditions.push(isNull(tasks.dueDate));
  }

  const orderBy = (() => {
    switch (filters.orderBy) {
      case 'dueDate':
        return [sql`${tasks.dueDate} asc nulls last`, asc(tasks.dueTime), asc(tasks.sortOrder)];
      case 'created':
        return [desc(tasks.createdAt)];
      case 'priority':
        return [asc(tasks.sortOrder)];
      default:
        return [asc(tasks.sortOrder), desc(tasks.createdAt)];
    }
  })();

  const rows = await db
    .select({
      task: tasks,
      project: {
        id: projects.id,
        name: projects.name,
        identifier: projects.identifier,
        color: projects.color,
      },
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(filters.limit ?? 500);

  const taskIds = rows.map((row) => row.task.id);

  const [labelRows, subtaskRows] = await Promise.all([
    taskIds.length > 0
      ? db
          .select({
            taskId: taskLabels.taskId,
            id: labels.id,
            name: labels.name,
            color: labels.color,
          })
          .from(taskLabels)
          .innerJoin(labels, eq(labels.id, taskLabels.labelId))
          .where(inArray(taskLabels.taskId, taskIds))
      : Promise.resolve([] as { taskId: string; id: string; name: string; color: string | null }[]),
    taskIds.length > 0
      ? db
          .select({ parentTaskId: tasks.parentTaskId, status: tasks.status })
          .from(tasks)
          .where(inArray(tasks.parentTaskId, taskIds))
      : Promise.resolve([] as { parentTaskId: string | null; status: TaskStatus }[]),
  ]);

  const labelsByTask = new Map<string, LabelRef[]>();
  for (const row of labelRows) {
    const list = labelsByTask.get(row.taskId) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    labelsByTask.set(row.taskId, list);
  }

  const subtasksByParent = new Map<string, { total: number; done: number }>();
  for (const row of subtaskRows) {
    if (!row.parentTaskId) continue;
    const entry = subtasksByParent.get(row.parentTaskId) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (row.status === 'done') entry.done += 1;
    subtasksByParent.set(row.parentTaskId, entry);
  }

  const result = rows.map((row) => {
    const subtasks = subtasksByParent.get(row.task.id) ?? { total: 0, done: 0 };
    return serializeTask({
      ...row.task,
      project: row.project?.id ? (row.project as ProjectRef) : null,
      labels: labelsByTask.get(row.task.id) ?? [],
      subtaskTotal: subtasks.total,
      subtaskDone: subtasks.done,
    });
  });

  if (filters.orderBy === 'priority') {
    result.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  }

  return result;
}

export async function getTask(id: string): Promise<TaskDTO | null> {
  const [row] = await db
    .select({
      task: tasks,
      project: {
        id: projects.id,
        name: projects.name,
        identifier: projects.identifier,
        color: projects.color,
      },
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, id))
    .limit(1);

  if (!row) return null;

  const [labelRows, subtasks] = await Promise.all([
    db
      .select({ id: labels.id, name: labels.name, color: labels.color })
      .from(taskLabels)
      .innerJoin(labels, eq(labels.id, taskLabels.labelId))
      .where(eq(taskLabels.taskId, id)),
    db.select({ status: tasks.status }).from(tasks).where(eq(tasks.parentTaskId, id)),
  ]);

  return serializeTask({
    ...row.task,
    project: row.project?.id ? (row.project as ProjectRef) : null,
    labels: labelRows,
    subtaskTotal: subtasks.length,
    subtaskDone: subtasks.filter((subtask) => subtask.status === 'done').length,
  });
}

export async function getSubtasks(parentTaskId: string): Promise<TaskDTO[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));

  return rows.map((row) => serializeTask(row));
}

/** Next manual position within a column, so new cards land at the bottom. */
export async function nextSortOrder(status: TaskStatus, projectId: string | null): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(max(${tasks.sortOrder}), 0)`.mapWith(Number) })
    .from(tasks)
    .where(
      projectId
        ? and(eq(tasks.status, status), eq(tasks.projectId, projectId))
        : and(eq(tasks.status, status), isNull(tasks.projectId)),
    );

  return (row?.value ?? 0) + 1;
}

export async function createTask(input: TaskCreateInput): Promise<TaskDTO> {
  const sortOrder = await nextSortOrder(input.status, input.projectId ?? null);

  // A recurring task with no date would never surface in Today or Upcoming, so
  // it is anchored to its first occurrence.
  const rule = parseRecurrence(input.recurrence);
  const dueDate = input.dueDate ?? (rule ? firstOccurrence(rule, todayIso()) : null);

  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description ?? null,
      status: input.status,
      priority: input.priority,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      assigneeType: input.assigneeType ?? null,
      assigneeId: input.assigneeId ?? null,
      dueDate,
      dueTime: input.dueTime ?? null,
      recurrence: input.recurrence ?? null,
      sortOrder,
      completedAt: input.status === 'done' ? new Date() : null,
    })
    .returning();

  if (input.labelIds?.length) {
    await setTaskLabels(row.id, input.labelIds);
  }

  const task = (await getTask(row.id))!;

  // The payload carries the task itself: a webhook that has to call back for
  // every notification is only half a webhook. `action` stays stable so a
  // receiver can switch on it.
  emitEvent('task.changed', { id: task.id, action: 'created', task });
  return task;
}

export type TaskUpdateResult = {
  task: TaskDTO;
  /**
   * Set when the caller asked to complete a recurring task: instead of closing
   * it, the same task was rolled forward to its next occurrence.
   */
  recurrenceAdvanced: { from: string | null; to: string } | null;
};

export async function updateTask(
  id: string,
  input: TaskUpdateInput,
): Promise<TaskUpdateResult | null> {
  const [current] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!current) return null;

  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  let recurrenceAdvanced: TaskUpdateResult['recurrenceAdvanced'] = null;

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.projectId !== undefined) patch.projectId = input.projectId ?? null;
  if (input.assigneeType !== undefined) patch.assigneeType = input.assigneeType ?? null;
  if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId ?? null;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate ?? null;
  if (input.dueTime !== undefined) patch.dueTime = input.dueTime ?? null;
  if (input.recurrence !== undefined) patch.recurrence = input.recurrence ?? null;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

  if (input.status !== undefined) {
    const rule = parseRecurrence(current.recurrence);
    const closing = input.status === 'done' && current.status !== 'done';

    if (rule && closing) {
      // Completing a repeating task means "done for this round": the task moves
      // to its next occurrence and stays open, the way Todoist behaves. The
      // activity log keeps the record of the round that was finished.
      const from = current.dueDate ?? todayIso();
      const to = nextOccurrence(rule, from, todayIso());

      patch.status = 'todo';
      patch.completedAt = null;
      if (input.dueDate === undefined) patch.dueDate = to;
      recurrenceAdvanced = { from: current.dueDate, to };
    } else {
      patch.status = input.status;
      // Keep completedAt in sync with the status transitions.
      if (input.status === 'done' && current.status !== 'done') patch.completedAt = new Date();
      if (input.status !== 'done' && current.status === 'done') patch.completedAt = null;
    }
  }

  const [row] = await db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
  if (!row) return null;

  const task = (await getTask(id))!;
  emitEvent('task.changed', { id, action: 'updated', task });
  return { task, recurrenceAdvanced };
}

export async function deleteTask(id: string): Promise<boolean> {
  const rows = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  if (rows.length > 0) emitEvent('task.changed', { id, action: 'deleted' });
  return rows.length > 0;
}

export async function setTaskLabels(taskId: string, labelIds: string[]): Promise<void> {
  await db.delete(taskLabels).where(eq(taskLabels.taskId, taskId));
  if (labelIds.length === 0) return;

  await db
    .insert(taskLabels)
    .values(labelIds.map((labelId) => ({ taskId, labelId })))
    .onConflictDoNothing();
}

/** Backlog + open work count, used by the sidebar badges. */
export async function countOpenTasks(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(tasks)
    .where(and(ne(tasks.status, 'done'), ne(tasks.status, 'cancelled')));
  return row?.value ?? 0;
}
