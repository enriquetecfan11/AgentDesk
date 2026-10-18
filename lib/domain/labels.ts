import 'server-only';

import { asc, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { labels, taskLabels, type Label } from '@/lib/db/schema';
import { serializeLabel } from '@/lib/domain/serialize';
import type { LabelDTO } from '@/lib/types';
import type { LabelCreateInput } from '@/lib/validation';

export async function listLabels(): Promise<LabelDTO[]> {
  const rows = await db.select().from(labels).orderBy(asc(labels.name));
  if (rows.length === 0) return [];

  const usage = await db
    .select({ labelId: taskLabels.labelId })
    .from(taskLabels)
    .where(
      inArray(
        taskLabels.labelId,
        rows.map((row) => row.id),
      ),
    );

  const counts = new Map<string, number>();
  for (const row of usage) {
    counts.set(row.labelId, (counts.get(row.labelId) ?? 0) + 1);
  }

  return rows.map((label) => serializeLabel(label, counts.get(label.id) ?? 0));
}

export async function createLabel(input: LabelCreateInput): Promise<LabelDTO> {
  const [row] = await db
    .insert(labels)
    .values({ name: input.name, color: input.color ?? null })
    // Idempotent by name: creating an existing label just updates its colour.
    .onConflictDoUpdate({ target: labels.name, set: { color: input.color ?? null } })
    .returning();

  return serializeLabel(row, 0);
}

export async function deleteLabel(id: string): Promise<boolean> {
  const rows = await db.delete(labels).where(eq(labels.id, id)).returning({ id: labels.id });
  return rows.length > 0;
}

/** Used by quick capture, which invents labels like `#wazuh` on the fly. */
export async function findOrCreateLabelByName(
  name: string,
  color?: string | null,
): Promise<Label> {
  const [existing] = await db.select().from(labels).where(eq(labels.name, name)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(labels)
    .values({ name, color: color ?? null })
    .onConflictDoUpdate({ target: labels.name, set: { name } })
    .returning();

  return created;
}
