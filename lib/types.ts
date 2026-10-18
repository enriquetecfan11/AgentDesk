/**
 * Data-transfer shapes handed from Server Components to Client Components.
 *
 * Everything is JSON-safe: timestamps are ISO strings, not `Date` instances.
 * This is the contract the UI codes against, so the domain layer is free to
 * change how it reads the database.
 */
import type { TaskPriorityValue, TaskStatusValue } from '@/lib/constants';

export type ProjectRef = {
  id: string;
  name: string;
  identifier: string | null;
  color: string | null;
};

export type LabelRef = {
  id: string;
  name: string;
  color: string | null;
};

export type TaskDTO = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatusValue;
  priority: TaskPriorityValue;
  projectId: string | null;
  parentTaskId: string | null;
  assigneeType: 'human' | 'agent' | null;
  assigneeId: string | null;
  dueDate: string | null;
  dueTime: string | null;
  recurrence: string | null;
  sortOrder: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: ProjectRef | null;
  labels: LabelRef[];
  subtaskTotal: number;
  subtaskDone: number;
};

export type ProjectDTO = {
  id: string;
  identifier: string | null;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'archived';
  color: string | null;
  targetDate: string | null;
  milestones: Milestone[];
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  taskTotal: number;
  taskDone: number;
};

export type Milestone = { title: string; done: boolean; date?: string | null };

export type LabelDTO = {
  id: string;
  name: string;
  color: string | null;
  usage: number;
};

export type ActivityDTO = {
  id: string;
  actorType: 'human' | 'agent' | 'system';
  actorId: string | null;
  actorName: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type NoteDTO = {
  id: string;
  title: string;
  contentMd: string;
  source: 'app' | 'obsidian';
  projectId: string | null;
  taskId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Minimal reference used by the backlink and outgoing-link lists. */
export type NoteRef = { id: string; title: string };

export type NoteListItemDTO = {
  id: string;
  title: string;
  /** Plain-text beginning of the note, for the list. */
  excerpt: string;
  projectId: string | null;
  project: ProjectRef | null;
  updatedAt: string;
  createdAt: string;
  /** Notes this one links to. */
  outgoingCount: number;
  /** Notes that link to this one. */
  backlinkCount: number;
};

export type NoteDetailDTO = {
  note: NoteDTO;
  project: ProjectRef | null;
  /** Notes pointing here. */
  backlinks: NoteRef[];
  /** Targets of this note's `[[links]]`; `note: null` means it does not exist yet. */
  outgoing: { title: string; note: NoteRef | null }[];
  /** Other notes sharing the same project, used as a plain "related" list. */
  related: NoteRef[];
};
