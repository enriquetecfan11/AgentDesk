/**
 * Recurrence engine.
 *
 * A deliberately small subset of RFC 5545, stored in the `tasks.recurrence`
 * column as an RRULE fragment:
 *
 *   FREQ=DAILY
 *   FREQ=DAILY;INTERVAL=3
 *   FREQ=WEEKLY;BYDAY=MO,WE,FR
 *   FREQ=MONTHLY;BYMONTHDAY=15
 *
 * Anything more complex (COUNT, UNTIL, BYSETPOS…) is out of scope: this is a
 * personal workspace, not a calendaring engine. The rules that do exist are
 * exact and testable.
 */
import { addDays, addMonths, addWeeks, addYears, startOfDay } from 'date-fns';

import { formatDateOnly, parseDateOnly } from '@/lib/dates';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export type Recurrence = {
  freq: Frequency;
  /** Every N periods. 1 means every period. */
  interval: number;
  /** 0 = Sunday … 6 = Saturday. Only meaningful for WEEKLY. */
  byDay?: number[];
  /** Day of the month. Only meaningful for MONTHLY. */
  byMonthDay?: number;
};

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;

/** Human-readable summary, used in the task panel and the capture preview. */
export function describeRecurrence(rule: Recurrence): string {
  switch (rule.freq) {
    case 'DAILY':
      return rule.interval === 1 ? 'todos los días' : `cada ${rule.interval} días`;
    case 'WEEKLY': {
      if (rule.byDay && rule.byDay.length > 0) {
        const names = [...rule.byDay].sort().map((day) => DAY_NAMES[day]);
        const prefix = rule.interval > 1 ? `cada ${rule.interval} semanas, ` : '';
        if (names.length === 1) return `${prefix}cada ${names[0]}`;
        return `${prefix}los ${names.join(', ')}`;
      }
      return rule.interval === 1 ? 'todas las semanas' : `cada ${rule.interval} semanas`;
    }
    case 'MONTHLY':
      return rule.interval === 1 ? 'todos los meses' : `cada ${rule.interval} meses`;
    case 'YEARLY':
      return rule.interval === 1 ? 'todos los años' : `cada ${rule.interval} años`;
  }
}

export function formatRecurrence(rule: Recurrence): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length > 0) {
    parts.push(`BYDAY=${[...rule.byDay].sort().map((day) => DAY_CODES[day]).join(',')}`);
  }
  if (rule.freq === 'MONTHLY' && rule.byMonthDay) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay}`);
  }
  return parts.join(';');
}

export function parseRecurrence(value: string | null | undefined): Recurrence | null {
  if (!value) return null;

  const fields = new Map<string, string>();
  for (const chunk of value.split(';')) {
    const [key, raw] = chunk.split('=');
    if (key && raw) fields.set(key.trim().toUpperCase(), raw.trim().toUpperCase());
  }

  const freq = fields.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }

  const interval = Number(fields.get('INTERVAL') ?? '1');
  const rule: Recurrence = {
    freq,
    interval: Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1,
  };

  const byDay = fields.get('BYDAY');
  if (byDay) {
    const days = byDay
      .split(',')
      .map((code) => DAY_CODES.indexOf(code.trim() as (typeof DAY_CODES)[number]))
      .filter((index) => index >= 0);
    if (days.length > 0) rule.byDay = days;
  }

  const byMonthDay = Number(fields.get('BYMONTHDAY') ?? '0');
  if (byMonthDay >= 1 && byMonthDay <= 31) rule.byMonthDay = byMonthDay;

  return rule;
}

/** Advances a single occurrence, ignoring any lower bound. */
function step(rule: Recurrence, from: Date): Date {
  switch (rule.freq) {
    case 'DAILY':
      return addDays(from, rule.interval);

    case 'WEEKLY': {
      if (!rule.byDay || rule.byDay.length === 0) return addWeeks(from, rule.interval);

      // Walk forward day by day, at most `interval` weeks, and take the first
      // day whose weekday is selected.
      const limit = rule.interval * 7;
      for (let offset = 1; offset <= limit; offset += 1) {
        const candidate = addDays(from, offset);
        if (rule.byDay.includes(candidate.getDay())) return candidate;
      }
      return addWeeks(from, rule.interval);
    }

    case 'MONTHLY': {
      const next = addMonths(from, rule.interval);
      if (rule.byMonthDay) {
        // Clamp: 31 February becomes 28/29 February.
        next.setDate(Math.min(rule.byMonthDay, daysInMonth(next)));
      }
      return next;
    }

    case 'YEARLY':
      return addYears(from, rule.interval);
  }
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/**
 * First occurrence strictly after `after` (defaults to `from`).
 *
 * Example: a daily task due yesterday, completed today, moves to tomorrow —
 * not to today, which would make it look like it was never done.
 */
export function nextOccurrence(rule: Recurrence, fromIso: string, afterIso?: string): string {
  const from = startOfDay(parseDateOnly(fromIso));
  const floor = startOfDay(parseDateOnly(afterIso ?? fromIso));

  let candidate = from;
  for (let guard = 0; guard < 2000; guard += 1) {
    candidate = step(rule, candidate);
    if (candidate.getTime() > floor.getTime()) break;
  }

  return formatDateOnly(candidate);
}

/**
 * First occurrence on or after `fromIso`.
 *
 * A recurring task typed without a date ("pasarse por el gimnasio cada lunes")
 * still needs a due date, otherwise it would never show up in Today or
 * Upcoming.
 */
export function firstOccurrence(rule: Recurrence, fromIso: string): string {
  if (matchesRecurrence(rule, fromIso)) return fromIso;
  return nextOccurrence(rule, fromIso, fromIso);
}

/** True when the given date falls on the rule's schedule. */
export function matchesRecurrence(rule: Recurrence, iso: string): boolean {
  const date = parseDateOnly(iso);

  switch (rule.freq) {
    case 'DAILY':
      return true;
    case 'WEEKLY':
      return !rule.byDay || rule.byDay.length === 0
        ? true
        : rule.byDay.includes(date.getDay());
    case 'MONTHLY':
      return !rule.byMonthDay || date.getDate() === rule.byMonthDay;
    case 'YEARLY':
      return true;
  }
}
