import { z } from 'zod';

import type { NoteFilters } from '@/lib/domain/notes';
import type { TaskFilters } from '@/lib/domain/tasks';
import {
  noteAuthorTypeSchema,
  noteListQuerySchema,
  taskPriority,
  taskStatus,
} from '@/lib/validation';

/**
 * Parses the shared task filter query string.
 *
 * Unknown or malformed values are dropped rather than rejected: a stale
 * bookmark should show something useful, not a 422.
 */
export function taskFiltersFromUrl(url: string): TaskFilters {
  const params = new URL(url).searchParams;
  const filters: TaskFilters = {};

  const projectId = params.get('projectId');
  if (projectId) filters.projectId = projectId;

  const statuses = params.get('status');
  if (statuses) {
    const parsed = statuses
      .split(',')
      .map((value) => value.trim())
      .filter((value) => taskStatus.safeParse(value).success);
    if (parsed.length > 0) filters.statuses = parsed as TaskFilters['statuses'];
  }

  const priorities = params.get('priority');
  if (priorities) {
    const parsed = priorities
      .split(',')
      .map((value) => value.trim())
      .filter((value) => taskPriority.safeParse(value).success);
    if (parsed.length > 0) filters.priorities = parsed as TaskFilters['priorities'];
  }

  const assigneeType = params.get('assigneeType');
  if (assigneeType === 'human' || assigneeType === 'agent') filters.assigneeType = assigneeType;

  const search = params.get('q');
  if (search) filters.search = search;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const dueBefore = params.get('dueBefore');
  if (dueBefore && dateOnly.test(dueBefore)) filters.dueOnOrBefore = dueBefore;

  const dueAfter = params.get('dueAfter');
  if (dueAfter && dateOnly.test(dueAfter)) filters.dueOnOrAfter = dueAfter;

  if (params.get('rootOnly') === '1') filters.rootOnly = true;
  if (params.get('inbox') === '1') filters.inboxOnly = true;

  const order = params.get('order');
  if (order === 'dueDate' || order === 'created' || order === 'priority' || order === 'manual') {
    filters.orderBy = order;
  }

  return filters;
}

/**
 * Parses the note listing query string.
 *
 * Same rule as the task filters: a malformed value is dropped, not fatal, so a
 * stale bookmark keeps showing notes. Paging has hard bounds because `limit`
 * is an unbounded cost on a table that can hold 200 KB bodies.
 */
export function noteFiltersFromUrl(url: string): {
  filters: NoteFilters;
  limit: number;
  offset: number;
} {
  const params = new URL(url).searchParams;
  const parsed = noteListQuerySchema.safeParse(Object.fromEntries(params));

  if (parsed.success) {
    const { q, projectId, authorType, authorId, limit, offset } = parsed.data;
    return { filters: { search: q || undefined, projectId, authorType, authorId }, limit, offset };
  }

  // A single malformed value must not discard the rest of the query.
  const filters: NoteFilters = {};

  const search = params.get('q')?.trim();
  if (search) filters.search = search;

  const projectId = params.get('projectId');
  if (projectId && z.uuid().safeParse(projectId).success) filters.projectId = projectId;

  const authorId = params.get('authorId');
  if (authorId && z.uuid().safeParse(authorId).success) filters.authorId = authorId;

  const authorType = noteAuthorTypeSchema.safeParse(params.get('authorType'));
  if (authorType.success) filters.authorType = authorType.data;

  const limit = z.coerce.number().int().min(1).max(500).safeParse(params.get('limit') ?? 100);
  const offset = z.coerce.number().int().min(0).safeParse(params.get('offset') ?? 0);

  return {
    filters,
    limit: limit.success ? limit.data : 100,
    offset: offset.success ? offset.data : 0,
  };
}
