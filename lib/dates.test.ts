import { describe, expect, it } from 'vitest';

import { formatDueLabel, formatDateOnly, isOverdue, parseDateOnly, todayIso } from '@/lib/dates';

/**
 * `YYYY-MM-DD` strings have no timezone. Parsing them with `new Date(str)`
 * treats them as UTC and, west of Greenwich, silently moves the date back one
 * day. These tests pin the local-midnight behaviour.
 */
describe('parseDateOnly', () => {
  it('produces local midnight, not UTC midnight', () => {
    const date = parseDateOnly('2026-03-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
  });

  it('round-trips through formatDateOnly', () => {
    expect(formatDateOnly(parseDateOnly('2026-12-31'))).toBe('2026-12-31');
    expect(formatDateOnly(parseDateOnly('2026-01-01'))).toBe('2026-01-01');
  });
});

describe('formatDueLabel', () => {
  function isoDaysFromToday(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return formatDateOnly(date);
  }

  it('labels today and tomorrow in Spanish', () => {
    expect(formatDueLabel(isoDaysFromToday(0))).toBe('Hoy');
    expect(formatDueLabel(isoDaysFromToday(1))).toBe('Mañana');
    expect(formatDueLabel(isoDaysFromToday(-1))).toBe('Ayer');
  });

  it('appends the time in HH:MM', () => {
    expect(formatDueLabel(isoDaysFromToday(0), '10:00:00')).toBe('Hoy 10:00');
    expect(formatDueLabel(isoDaysFromToday(1), '09:30:00')).toBe('Mañana 09:30');
  });

  it('uses the weekday name for the rest of the week', () => {
    expect(formatDueLabel(isoDaysFromToday(3))).toMatch(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo)$/);
  });
});

describe('isOverdue', () => {
  function isoDaysFromToday(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return formatDateOnly(date);
  }

  it('is false without a due date', () => {
    expect(isOverdue(null, 'todo')).toBe(false);
  });

  it('is true for a past date on an open task', () => {
    expect(isOverdue(isoDaysFromToday(-2), 'todo')).toBe(true);
  });

  it('is false for today and for closed tasks', () => {
    expect(isOverdue(isoDaysFromToday(0), 'todo')).toBe(false);
    expect(isOverdue(isoDaysFromToday(-5), 'done')).toBe(false);
    expect(isOverdue(isoDaysFromToday(-5), 'cancelled')).toBe(false);
  });
});

describe('todayIso', () => {
  it('matches the local date, not the UTC date', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    expect(todayIso()).toBe(expected);
  });
});
