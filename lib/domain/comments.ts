import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { activityLog } from '@/lib/db/schema';
import { emitEvent } from '@/lib/domain/events';
import type { ActivityActor } from '@/lib/domain/activity';
import type { TaskCommentDTO } from '@/lib/types';

/**
 * Task comments are activity entries.
 *
 * Comments already need everything the timeline has: an author that can be a
 * human or an agent, a timestamp and a body. Reusing the table keeps them
 * append-only (nothing to edit or lose), puts them in the unified activity feed
 * for free, and avoids a join table that would only ever hold a string.
 *
 * The trade-off, documented in the README: a comment cannot be edited later.
 */
const COMMENT_ACTION = 'task.comment';

type CommentRow = typeof activityLog.$inferSelect;

function serializeComment(row: CommentRow): TaskCommentDTO {
  const meta = (row.meta ?? {}) as { body?: unknown };

  return {
    id: row.id,
    taskId: row.entityId ?? '',
    authorType: row.actorType,
    authorName: row.actorName,
    body: typeof meta.body === 'string' ? meta.body : '',
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
  };
}

export async function listTaskComments(taskId: string, limit = 200): Promise<TaskCommentDTO[]> {
  const rows = await db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, 'task'), eq(activityLog.entityId, taskId), eq(activityLog.action, COMMENT_ACTION)))
    .orderBy(asc(activityLog.createdAt))
    .limit(limit);

  return rows.map(serializeComment);
}

export async function addTaskComment(
  taskId: string,
  author: ActivityActor,
  body: string,
): Promise<TaskCommentDTO> {
  const [row] = await db
    .insert(activityLog)
    .values({
      actorType: author.type,
      actorId: author.id ?? null,
      actorName: author.name,
      action: COMMENT_ACTION,
      entityType: 'task',
      entityId: taskId,
      meta: { body },
    })
    .returning();

  const comment = serializeComment(row);
  emitEvent('task.comment', comment);
  return comment;
}
