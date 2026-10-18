import { describe, expect, it } from 'vitest';

import { taskFiltersFromUrl } from '@/lib/api/query';

const base = 'http://192.168.1.50:3000/api/tasks';

describe('taskFiltersFromUrl', () => {
  it('returns no filters for a bare URL', () => {
    expect(taskFiltersFromUrl(base)).toEqual({});
  });

  it('reads the project, search and order', () => {
    const filters = taskFiltersFromUrl(`${base}?projectId=abc&q=cve&order=dueDate`);
    expect(filters.projectId).toBe('abc');
    expect(filters.search).toBe('cve');
    expect(filters.orderBy).toBe('dueDate');
  });

  it('splits comma-separated status and priority lists', () => {
    const filters = taskFiltersFromUrl(`${base}?status=todo,in_progress&priority=urgent,high`);
    expect(filters.statuses).toEqual(['todo', 'in_progress']);
    expect(filters.priorities).toEqual(['urgent', 'high']);
  });

  it('drops malformed values instead of throwing', () => {
    const filters = taskFiltersFromUrl(
      `${base}?status=todo,inventado,&priority=nope&order=random&assigneeType=robot`,
    );
    expect(filters.statuses).toEqual(['todo']);
    expect(filters.priorities).toBeUndefined();
    expect(filters.orderBy).toBeUndefined();
    expect(filters.assigneeType).toBeUndefined();
  });

  it('ignores an empty list rather than filtering everything out', () => {
    expect(taskFiltersFromUrl(`${base}?status=,,`).statuses).toBeUndefined();
  });

  it('reads the boolean flags', () => {
    const filters = taskFiltersFromUrl(`${base}?rootOnly=1&inbox=1`);
    expect(filters.rootOnly).toBe(true);
    expect(filters.inboxOnly).toBe(true);
  });

  it('reads the date window, ignoring malformed dates', () => {
    const filters = taskFiltersFromUrl(`${base}?dueBefore=2026-01-31&dueAfter=2026-01-01`);
    expect(filters.dueOnOrBefore).toBe('2026-01-31');
    expect(filters.dueOnOrAfter).toBe('2026-01-01');

    const malformed = taskFiltersFromUrl(`${base}?dueBefore=31/01/2026&dueAfter=ayer`);
    expect(malformed.dueOnOrBefore).toBeUndefined();
    expect(malformed.dueOnOrAfter).toBeUndefined();
  });
});
