import type { ActivityEntry, Label, Note, Project, Task } from '@/lib/db/schema';
import type {
  ActivityDTO,
  LabelDTO,
  LabelRef,
  Milestone,
  NoteDTO,
  ProjectDTO,
  ProjectRef,
  TaskDTO,
} from '@/lib/types';

/** Normalises a timestamp column to an ISO string (or null). */
function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export type TaskSource = Task & {
  project?: ProjectRef | null;
  labels?: LabelRef[];
  subtaskTotal?: number;
  subtaskDone?: number;
};

export function serializeTask(task: TaskSource): TaskDTO {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    parentTaskId: task.parentTaskId,
    assigneeType: task.assigneeType,
    assigneeId: task.assigneeId,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    recurrence: task.recurrence,
    sortOrder: task.sortOrder,
    completedAt: iso(task.completedAt),
    createdAt: iso(task.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(task.updatedAt) ?? new Date(0).toISOString(),
    project: task.project ?? null,
    labels: task.labels ?? [],
    subtaskTotal: task.subtaskTotal ?? 0,
    subtaskDone: task.subtaskDone ?? 0,
  };
}

export function serializeMilestones(value: unknown): Milestone[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.title !== 'string') return [];
    return [
      {
        title: record.title,
        done: record.done === true,
        date: typeof record.date === 'string' ? record.date : null,
      },
    ];
  });
}

export function serializeProject(
  project: Project,
  counts: { taskTotal: number; taskDone: number },
): ProjectDTO {
  return {
    id: project.id,
    identifier: project.identifier,
    name: project.name,
    description: project.description,
    status: project.status,
    color: project.color,
    targetDate: project.targetDate,
    milestones: serializeMilestones(project.milestones),
    sortOrder: project.sortOrder,
    archivedAt: iso(project.archivedAt),
    createdAt: iso(project.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(project.updatedAt) ?? new Date(0).toISOString(),
    taskTotal: counts.taskTotal,
    taskDone: counts.taskDone,
  };
}

export function serializeLabel(label: Label, usage: number): LabelDTO {
  return { id: label.id, name: label.name, color: label.color, usage };
}

export function serializeNote(note: Note): NoteDTO {
  return {
    id: note.id,
    title: note.title,
    contentMd: note.contentMd,
    source: note.source,
    projectId: note.projectId,
    taskId: note.taskId,
    createdAt: iso(note.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(note.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function serializeActivity(entry: ActivityEntry): ActivityDTO {
  return {
    id: entry.id,
    actorType: entry.actorType,
    actorId: entry.actorId,
    actorName: entry.actorName,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    meta: (entry.meta as Record<string, unknown> | null) ?? null,
    createdAt: iso(entry.createdAt) ?? new Date(0).toISOString(),
  };
}
