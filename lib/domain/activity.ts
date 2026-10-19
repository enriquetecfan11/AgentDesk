import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { activityLog } from '@/lib/db/schema';
import { emitEvent } from '@/lib/domain/events';
import { serializeActivity } from '@/lib/domain/serialize';
import type { ActivityDTO } from '@/lib/types';

export type ActivityActor = {
  type: 'human' | 'agent' | 'system';
  id?: string | null;
  name: string;
};

export type LogActivityInput = {
  actor: ActivityActor;
  /** Machine-readable action name, e.g. "task.created". */
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown> | null;
};

/**
 * Appends to the unified timeline.
 *
 * Activity logging must never break the operation it describes, so failures are
 * logged and swallowed.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await db.insert(activityLog).values({
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      actorName: input.actor.name,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      meta: input.meta ?? null,
    });

    // One event for the whole timeline: a client watching the stream only has
    // to know that something moved, and refetches what it is showing.
    emitEvent('activity', {
      action: input.action,
      actorType: input.actor.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    });
  } catch (error) {
    console.error('[activity] no se pudo registrar la actividad', error);
  }
}

export async function listActivity(limit = 150): Promise<ActivityDTO[]> {
  const rows = await db
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);

  return rows.map(serializeActivity);
}

export async function listActivityForEntity(
  entityType: string,
  entityId: string,
  limit = 30,
): Promise<ActivityDTO[]> {
  const rows = await db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.entityType, entityType), eq(activityLog.entityId, entityId)))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);

  return rows.map(serializeActivity);
}
