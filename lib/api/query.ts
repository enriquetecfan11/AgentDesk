import type { TaskFilters } from '@/lib/domain/tasks';
import { taskPriority, taskStatus } from '@/lib/validation';

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

  if (params.get('rootOnly') === '1') filters.rootOnly = true;
  if (params.get('inbox') === '1') filters.inboxOnly = true;

  const order = params.get('order');
  if (order === 'dueDate' || order === 'created' || order === 'priority' || order === 'manual') {
    filters.orderBy = order;
  }

  return filters;
}
