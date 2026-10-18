import 'server-only';

import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';

import { TERMINAL_RUN_STATUSES, type RunStatusValue } from '@/lib/constants';
import { db } from '@/lib/db/client';
import { agents, artifacts, runs, runLogs, tasks } from '@/lib/db/schema';
import { updateDelegationStatus } from '@/lib/domain/delegations';
import { serializeArtifact, serializeRun, serializeRunLog } from '@/lib/domain/serialize';
import { emitEvent } from '@/lib/domain/events';
import { safeFileName, saveUpload, removeUpload, removeUploadDir } from '@/lib/storage';
import type { ArtifactDTO, RunDTO, RunDetailDTO, RunLogDTO } from '@/lib/types';
import type {
  ArtifactCreateInput,
  RunCreateInput,
  RunLogCreateInput,
  RunUpdateInput,
} from '@/lib/validation';

export type RunFilters = {
  agentId?: string;
  taskId?: string;
  delegationId?: string;
  statuses?: RunStatusValue[];
  limit?: number;
};

const SELECTION = {
  run: runs,
  agent: { id: agents.id, name: agents.name },
  task: { id: tasks.id, title: tasks.title },
};

/**
 * Runs, each with its log and artifact counters.
 *
 * The counters come from two grouped queries merged in memory rather than from
 * correlated subqueries: fewer surprises with the query builder, and a
 * personal workspace has thousands of runs at most.
 */
export async function listRuns(filters: RunFilters = {}): Promise<RunDTO[]> {
  const conditions = [];

  if (filters.agentId) conditions.push(eq(runs.agentId, filters.agentId));
  if (filters.taskId) conditions.push(eq(runs.taskId, filters.taskId));
  if (filters.delegationId) conditions.push(eq(runs.delegationId, filters.delegationId));
  if (filters.statuses?.length) conditions.push(inArray(runs.status, filters.statuses));

  const rows = await db
    .select(SELECTION)
    .from(runs)
    .leftJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(tasks, eq(tasks.id, runs.taskId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(runs.createdAt))
    .limit(filters.limit ?? 100);

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.run.id);

  const [logRows, artifactRows] = await Promise.all([
    db
      .select({ runId: runLogs.runId, value: sql<number>`count(*)`.mapWith(Number) })
      .from(runLogs)
      .where(inArray(runLogs.runId, ids))
      .groupBy(runLogs.runId),
    db
      .select({ runId: artifacts.runId, value: sql<number>`count(*)`.mapWith(Number) })
      .from(artifacts)
      .where(inArray(artifacts.runId, ids))
      .groupBy(artifacts.runId),
  ]);

  const logCount = new Map(logRows.map((row) => [row.runId, row.value]));
  const artifactCount = new Map(artifactRows.map((row) => [row.runId, row.value]));

  return rows.map((row) =>
    serializeRun(row.run, {
      agent: row.agent?.id ? row.agent : null,
      task: row.task?.id ? (row.task as { id: string; title: string }) : null,
      logCount: logCount.get(row.run.id) ?? 0,
      artifactCount: artifactCount.get(row.run.id) ?? 0,
    }),
  );
}

export async function getRun(id: string): Promise<RunDTO | null> {
  const [row] = await db
    .select(SELECTION)
    .from(runs)
    .leftJoin(agents, eq(agents.id, runs.agentId))
    .leftJoin(tasks, eq(tasks.id, runs.taskId))
    .where(eq(runs.id, id))
    .limit(1);

  if (!row) return null;

  const [logs, files] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(runLogs)
      .where(eq(runLogs.runId, id)),
    db
      .select({ value: sql<number>`count(*)`.mapWith(Number) })
      .from(artifacts)
      .where(eq(artifacts.runId, id)),
  ]);

  return serializeRun(row.run, {
    agent: row.agent?.id ? row.agent : null,
    task: row.task?.id ? (row.task as { id: string; title: string }) : null,
    logCount: logs[0]?.value ?? 0,
    artifactCount: files[0]?.value ?? 0,
  });
}

export async function getRunDetail(id: string): Promise<RunDetailDTO | null> {
  const run = await getRun(id);
  if (!run) return null;

  const [logs, files] = await Promise.all([listRunLogs(id), listArtifacts({ runId: id })]);

  return { run, logs, artifacts: files };
}

export type CreateRunInput = Omit<RunCreateInput, 'agentId'> & { agentId: string };

export async function createRun(input: CreateRunInput): Promise<RunDTO> {
  const [row] = await db
    .insert(runs)
    .values({
      agentId: input.agentId,
      taskId: input.taskId ?? null,
      delegationId: input.delegationId ?? null,
      status: input.status,
      input: input.input ?? null,
      startedAt: input.status === 'running' ? new Date() : null,
    })
    .returning();

  // Starting work on a delegation is what moves it to "in progress"; the agent
  // should not have to say the same thing twice.
  if (input.delegationId) {
    await updateDelegationStatus(input.delegationId, { status: 'in_progress' });
  }

  const run = (await getRun(row.id))!;
  emitEvent('run.updated', { id: run.id, status: run.status, agentId: run.agentId, run });
  return run;
}

/**
 * Updates a run and keeps its clock consistent.
 *
 * `startedAt` is stamped on the way into `running`; `finishedAt` and
 * `durationMs` on the way into a terminal status. The agent only reports the
 * status, never the timings — otherwise every client would have to agree on
 * what a duration means.
 */
export async function updateRun(id: string, input: RunUpdateInput): Promise<RunDTO | null> {
  const [current] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  if (!current) return null;

  const patch: Partial<typeof runs.$inferInsert> = { updatedAt: new Date() };

  if (input.output !== undefined) patch.output = input.output ?? null;
  if (input.error !== undefined) patch.error = input.error ?? null;
  if (input.costUsd !== undefined) patch.costUsd = input.costUsd === null ? null : String(input.costUsd);
  if (input.input !== undefined) patch.input = input.input ?? null;

  if (input.status !== undefined && input.status !== current.status) {
    patch.status = input.status;

    const startedAt = current.startedAt ?? (input.status === 'running' ? new Date() : null);
    if (input.status === 'running') patch.startedAt = startedAt;

    if (TERMINAL_RUN_STATUSES.includes(input.status)) {
      const finishedAt = new Date();
      patch.finishedAt = finishedAt;
      patch.durationMs = startedAt ? finishedAt.getTime() - startedAt.getTime() : null;
    }
  }

  const [row] = await db.update(runs).set(patch).where(eq(runs.id, id)).returning();
  if (!row) return null;

  const run = (await getRun(id))!;

  // A run that closes closes its delegation with it.
  if (row.delegationId && input.status && TERMINAL_RUN_STATUSES.includes(input.status)) {
    await updateDelegationStatus(row.delegationId, {
      status: input.status === 'succeeded' ? 'completed' : 'failed',
    });
  }

  emitEvent('run.updated', { id: run.id, status: run.status, agentId: run.agentId, run });
  return run;
}

export async function deleteRun(id: string): Promise<boolean> {
  // Los ficheros primero: sus filas se van en cascada.
  await purgeRunFiles([id]);

  const rows = await db.delete(runs).where(eq(runs.id, id)).returning({ id: runs.id });
  return rows.length > 0;
}

export async function countActiveRuns(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)`.mapWith(Number) })
    .from(runs)
    .where(inArray(runs.status, ['queued', 'running']));
  return row?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function listRunLogs(
  runId: string,
  options: { since?: Date; limit?: number } = {},
): Promise<RunLogDTO[]> {
  const conditions = [eq(runLogs.runId, runId)];
  if (options.since) conditions.push(gt(runLogs.createdAt, options.since));

  const rows = await db
    .select()
    .from(runLogs)
    .where(and(...conditions))
    // Oldest first: a log is read like a log.
    .orderBy(asc(runLogs.createdAt), asc(runLogs.id))
    .limit(options.limit ?? 1000);

  return rows.map(serializeRunLog);
}

/** Appends lines and pushes each one over SSE, so a watcher sees it live. */
export async function appendRunLogs(
  runId: string,
  logs: RunLogCreateInput[],
): Promise<RunLogDTO[]> {
  const [exists] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!exists) return [];

  const rows = await db
    .insert(runLogs)
    .values(logs.map((log) => ({ runId, level: log.level, message: log.message })))
    .returning();

  const serialized = rows.map(serializeRunLog);
  for (const log of serialized) emitEvent('run.log', log);

  return serialized;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

export async function listArtifacts(
  filters: { runId?: string; taskId?: string; limit?: number } = {},
): Promise<ArtifactDTO[]> {
  const conditions = [];
  if (filters.runId) conditions.push(eq(artifacts.runId, filters.runId));
  if (filters.taskId) conditions.push(eq(artifacts.taskId, filters.taskId));

  const rows = await db
    .select()
    .from(artifacts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(artifacts.createdAt))
    .limit(filters.limit ?? 200);

  return rows.map(serializeArtifact);
}

export async function getArtifactRow(id: string) {
  const [row] = await db.select().from(artifacts).where(eq(artifacts.id, id)).limit(1);
  return row ?? null;
}

/**
 * Stores what an agent produced.
 *
 * Text and URLs stay in the database (they are small and searched); files go to
 * `UPLOADS_DIR` and only their relative path is kept, so the data directory can
 * be moved to another machine without touching rows.
 */
export async function createArtifact(input: ArtifactCreateInput): Promise<ArtifactDTO> {
  const kind = input.kind;
  const mimeType = input.mimeType ?? (kind === 'url' ? 'text/uri-list' : 'text/plain');

  const [row] = await db
    .insert(artifacts)
    .values({
      runId: input.runId ?? null,
      taskId: input.taskId ?? null,
      name: input.name,
      kind,
      mimeType,
      content: kind === 'file' ? null : (input.content ?? null),
      sizeBytes:
        kind === 'file'
          ? Buffer.from(input.contentBase64 ?? '', 'base64').byteLength
          : (input.content?.length ?? 0),
    })
    .returning();

  if (kind === 'file') {
    const bytes = Buffer.from(input.contentBase64 ?? '', 'base64');
    const relativePath = `artifacts/${input.runId ?? 'sin-run'}/${row.id}-${safeFileName(input.name)}`;

    await saveUpload(relativePath, bytes);

    const [stored] = await db
      .update(artifacts)
      .set({ storagePath: relativePath })
      .where(eq(artifacts.id, row.id))
      .returning();

    const storedArtifact = serializeArtifact(stored);
    emitEvent('run.artifact', {
      id: stored.id,
      runId: stored.runId,
      name: stored.name,
      // The body stays out of the event: a payload is a notification, and an
      // inline text artifact can be hundreds of kilobytes.
      artifact: { ...storedArtifact, content: null },
    });
    return storedArtifact;
  }

  const artifact = serializeArtifact(row);
  emitEvent('run.artifact', {
    id: row.id,
    runId: row.runId,
    name: row.name,
    artifact: { ...artifact, content: null },
  });
  return artifact;
}

export async function deleteArtifact(id: string): Promise<boolean> {
  const [row] = await db
    .delete(artifacts)
    .where(eq(artifacts.id, id))
    .returning({ id: artifacts.id, storagePath: artifacts.storagePath });

  if (!row) return false;

  if (row.storagePath) {
    await removeUpload(row.storagePath);
    // Si era el último fichero del run, su carpeta se va con él.
    const folder = row.storagePath.slice(0, row.storagePath.lastIndexOf('/'));
    if (folder) await removeUploadDir(folder);
  }

  return true;
}

/**
 * Removes the files of a set of runs.
 *
 * The rows would go away on their own through the foreign key cascade, but the
 * files live on a volume, and Postgres has no opinion about those. Called
 * before the rows disappear, while there is still something to read.
 */
export async function purgeRunFiles(runIds: string[]): Promise<number> {
  if (runIds.length === 0) return 0;

  const rows = await db
    .select({ storagePath: artifacts.storagePath })
    .from(artifacts)
    .where(inArray(artifacts.runId, runIds));

  const paths = rows.flatMap((row) => (row.storagePath ? [row.storagePath] : []));
  await Promise.all(paths.map((relativePath) => removeUpload(relativePath)));
  await Promise.all(runIds.map((runId) => removeUploadDir(`artifacts/${runId}`)));

  return paths.length;
}
