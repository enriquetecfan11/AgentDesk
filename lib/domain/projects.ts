import 'server-only';

import { asc, count, eq, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { projects, tasks, type Project } from '@/lib/db/schema';
import { serializeProject } from '@/lib/domain/serialize';
import type { ProjectDTO } from '@/lib/types';
import type { ProjectCreateInput, ProjectUpdateInput } from '@/lib/validation';

export async function listProjects(options: { includeArchived?: boolean } = {}): Promise<ProjectDTO[]> {
  const rows = await db
    .select({
      project: projects,
      taskTotal: count(tasks.id).mapWith(Number),
      taskDone: sql<number>`coalesce(count(*) filter (where ${tasks.status} = 'done'), 0)`.mapWith(
        Number,
      ),
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(options.includeArchived ? undefined : ne(projects.status, 'archived'))
    .groupBy(projects.id)
    .orderBy(asc(projects.sortOrder), asc(projects.name));

  return rows.map((row) =>
    serializeProject(row.project, { taskTotal: row.taskTotal, taskDone: row.taskDone }),
  );
}

/** Cheaper than `listProjects().length`: no joins, no per-project task counts. */
export async function countProjects(): Promise<number> {
  const [row] = await db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(projects);
  return row?.value ?? 0;
}

export async function getProject(id: string): Promise<ProjectDTO | null> {
  const [row] = await db
    .select({
      project: projects,
      taskTotal: count(tasks.id).mapWith(Number),
      taskDone: sql<number>`coalesce(count(*) filter (where ${tasks.status} = 'done'), 0)`.mapWith(
        Number,
      ),
    })
    .from(projects)
    .leftJoin(tasks, eq(tasks.projectId, projects.id))
    .where(eq(projects.id, id))
    .groupBy(projects.id)
    .limit(1);

  if (!row) return null;
  return serializeProject(row.project, { taskTotal: row.taskTotal, taskDone: row.taskDone });
}

export async function getProjectByIdentifier(identifier: string): Promise<ProjectDTO | null> {
  const [row] = await db
    .select()
    .from(projects)
    .where(eq(projects.identifier, identifier.toUpperCase()))
    .limit(1);

  return row ? serializeProject(row, { taskTotal: 0, taskDone: 0 }) : null;
}

export async function createProject(input: ProjectCreateInput): Promise<ProjectDTO> {
  const [maxOrder] = await db
    .select({ value: sql<number>`coalesce(max(${projects.sortOrder}), 0)`.mapWith(Number) })
    .from(projects);

  const [row] = await db
    .insert(projects)
    .values({
      name: input.name,
      identifier: input.identifier ?? null,
      description: input.description ?? null,
      status: input.status,
      color: input.color ?? null,
      targetDate: input.targetDate ?? null,
      sortOrder: (maxOrder?.value ?? 0) + 1,
    })
    .returning();

  return serializeProject(row, { taskTotal: 0, taskDone: 0 });
}

export async function updateProject(id: string, input: ProjectUpdateInput): Promise<ProjectDTO | null> {
  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };

  if (input.name !== undefined) patch.name = input.name;
  if (input.identifier !== undefined) patch.identifier = input.identifier ?? null;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.color !== undefined) patch.color = input.color ?? null;
  if (input.targetDate !== undefined) patch.targetDate = input.targetDate ?? null;
  if (input.milestones !== undefined) patch.milestones = input.milestones ?? [];
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.archivedAt = input.status === 'archived' ? new Date() : null;
  }

  const [row] = await db.update(projects).set(patch).where(eq(projects.id, id)).returning();
  if (!row) return null;

  return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const rows = await db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  return rows.length > 0;
}
