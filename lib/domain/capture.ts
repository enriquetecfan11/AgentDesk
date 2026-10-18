import 'server-only';

import { eq, ilike, or } from 'drizzle-orm';

import { parseCapture, type Capture } from '@/lib/capture';
import { db } from '@/lib/db/client';
import { projects } from '@/lib/db/schema';
import { findOrCreateLabelByName } from '@/lib/domain/labels';
import { createTask } from '@/lib/domain/tasks';
import type { TaskDTO } from '@/lib/types';

export type CaptureResult = {
  task: TaskDTO;
  /** What the parser understood, so the UI can show it back. */
  capture: Capture;
  /** Things that could not be resolved, shown as a warning. */
  notes: string[];
};

/** Case-insensitive match on the name, or an exact match on the identifier. */
async function findProject(query: string): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(or(ilike(projects.name, query), eq(projects.identifier, query.toUpperCase())))
    .limit(1);

  return row ?? null;
}

/**
 * Turns one line of text into a task.
 *
 * Deliberate asymmetry between the two tag sigils:
 *
 *   `@etiqueta` creates the label if it does not exist — labels are flat and
 *   cheap, exactly like tags in Todoist.
 *
 *   `#proyecto` must already exist — inventing projects from typos would
 *   scatter the workspace, and a project is a container people curate.
 */
export async function createTaskFromCapture(
  text: string,
  options: { projectId?: string | null } = {},
): Promise<CaptureResult> {
  const capture = parseCapture(text);
  const notes: string[] = [];

  let projectId = options.projectId ?? null;

  if (capture.projectQuery) {
    const project = await findProject(capture.projectQuery);

    if (project) {
      projectId = project.id;
    } else {
      notes.push(`No existe el proyecto «${capture.projectQuery}»: la tarea se guardó sin proyecto.`);
    }
  }

  const labelIds: string[] = [];
  for (const name of capture.labelQueries) {
    const label = await findOrCreateLabelByName(name);
    if (!labelIds.includes(label.id)) labelIds.push(label.id);
  }

  const task = await createTask({
    title: capture.title,
    status: 'todo',
    priority: capture.priority,
    projectId,
    dueDate: capture.dueDate,
    dueTime: capture.dueTime,
    recurrence: capture.recurrence,
    labelIds,
  });

  return { task, capture, notes };
}
