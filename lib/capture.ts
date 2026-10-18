/**
 * Natural-language quick capture.
 *
 *   revisar CVEs mañana 10:00 p1 #wazuh @seguridad
 *   → título "revisar CVEs"
 *     vence mañana a las 10:00, prioridad urgente
 *     proyecto "wazuh", etiqueta "seguridad"
 *
 * Every token is optional and the order is free. What cannot be understood is
 * left in the title: it is much worse to silently drop the user's words than
 * to show a task called "informe el viernes" with no date.
 *
 * The grammar is documented in the README so it can be relied on.
 */
import { addDays, addMonths, addWeeks } from 'date-fns';

import { type TaskPriorityValue } from '@/lib/constants';
import { formatDateOnly } from '@/lib/dates';
import { describeRecurrence, formatRecurrence, type Recurrence } from '@/lib/recurrence';

export type Capture = {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: TaskPriorityValue;
  /** Text after `#`, resolved against projects by the server. */
  projectQuery: string | null;
  /** Text after `@`, resolved (or created) as labels by the server. */
  labelQueries: string[];
  /** RRULE fragment, or null. */
  recurrence: string | null;
  /** Chips shown live under the input while typing. */
  hints: string[];
};

const WEEKDAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
] as const;

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

/** Lowercase and strip accents: "MIÉRCOLES" → "miercoles". */
function normalizeWord(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

const WEEKDAY_PATTERN = 'lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo';
const MONTH_PATTERN =
  'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';

const PRIORITY_WORDS: Record<string, TaskPriorityValue> = {
  urgente: 'urgent',
  urgentes: 'urgent',
  alta: 'high',
  alto: 'high',
  normal: 'normal',
  media: 'normal',
  medio: 'normal',
  baja: 'low',
  bajo: 'low',
};

const PRIORITY_CODES: Record<string, TaskPriorityValue> = {
  '1': 'urgent',
  '2': 'high',
  '3': 'normal',
  '4': 'low',
};

const PRIORITY_LABELS: Record<TaskPriorityValue, string> = {
  urgent: 'Urgente',
  high: 'Alta',
  normal: 'Normal',
  low: 'Baja',
  none: 'Sin prioridad',
};

/**
 * Next time the given weekday comes around.
 *
 * Saying "lunes" on a Monday means *next* Monday, not today: a capture typed
 * today is almost never about today when it names a weekday.
 */
function nextWeekday(from: Date, target: number): Date {
  const offset = (target - from.getDay() + 7) % 7 || 7;
  return addDays(from, offset);
}

/** Same day-of-month this month if it is still ahead, otherwise next month. */
function nextDayOfMonth(from: Date, day: number): Date | null {
  if (day < 1 || day > 31) return null;

  const candidate = new Date(from.getFullYear(), from.getMonth(), 1);
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  candidate.setDate(Math.min(day, lastDay));

  if (candidate.getTime() >= new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()) {
    return candidate;
  }

  const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const nextLastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, nextLastDay));
  return next;
}

export function parseCapture(raw: string, now: Date = new Date()): Capture {
  const original = raw.trim();

  // Padded so every pattern can rely on `\b`-free whitespace boundaries and a
  // token at the very start or end of the string still matches.
  let text = ` ${original.replace(/\s+/g, ' ')} `;
  const hints: string[] = [];

  /** Consumes the first match of `pattern` from the working text. */
  function take(pattern: RegExp): RegExpMatchArray | null {
    const match = text.match(pattern);
    if (!match || match.index === undefined) return null;
    text = `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`;
    return match;
  }

  // -------------------------------------------------------------------------
  // Recurrence — before dates, because "cada lunes" also contains a weekday.
  // -------------------------------------------------------------------------
  let rule: Recurrence | null = null;

  const intervalMatch = take(/\bcada (\d+|un|una) (d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?)\b/i);
  if (intervalMatch) {
    const count = normalizeWord(intervalMatch[1]) === 'un' || normalizeWord(intervalMatch[1]) === 'una'
      ? 1
      : Number(intervalMatch[1]);
    const unit = normalizeWord(intervalMatch[2]);
    const freq = unit.startsWith('dia') ? 'DAILY' : unit.startsWith('semana') ? 'WEEKLY' : unit.startsWith('mes') ? 'MONTHLY' : 'YEARLY';
    rule = { freq, interval: count >= 1 ? Math.floor(count) : 1 };
  }

  if (!rule) {
    const weekdayListMatch = take(
      new RegExp(
        `\\bcada ((?:${WEEKDAY_PATTERN})(?:\\s*(?:,|y)\\s*(?:${WEEKDAY_PATTERN}))*)\\b`,
        'i',
      ),
    );

    if (weekdayListMatch) {
      const days = weekdayListMatch[1]
        .split(/\s*(?:,|y)\s*/i)
        .map((name) => WEEKDAY_NAMES.indexOf(normalizeWord(name) as (typeof WEEKDAY_NAMES)[number]))
        .filter((index) => index >= 0);

      if (days.length > 0) rule = { freq: 'WEEKLY', interval: 1, byDay: [...new Set(days)] };
    }
  }

  if (!rule) {
    const simple = take(
      /\b(?:todos los d[ií]as|todas las semanas|todos los meses|todos los a[nñ]os|cada d[ií]a|cada semana|cada mes|cada a[nñ]o|diariamente|a diario|semanalmente|mensualmente|anualmente)\b/i,
    );

    if (simple) {
      const value = normalizeWord(simple[0]);
      const freq = value.includes('dia') ? 'DAILY' : value.includes('semana') ? 'WEEKLY' : value.includes('mes') ? 'MONTHLY' : 'YEARLY';
      rule = { freq, interval: 1 };
    }
  }

  // -------------------------------------------------------------------------
  // Date
  // -------------------------------------------------------------------------
  let dueDate: Date | null = null;

  const isoMatch = take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const parsed = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
  }

  if (!dueDate) {
    const slashMatch = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slashMatch) {
      const day = Number(slashMatch[1]);
      const month = Number(slashMatch[2]) - 1;
      let year = slashMatch[3] ? Number(slashMatch[3]) : now.getFullYear();
      if (year < 100) year += 2000;

      const parsed = new Date(year, month, day);
      // "15/01" typed in December almost always means January next year.
      if (!slashMatch[3] && parsed.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
        parsed.setFullYear(year + 1);
      }
      if (!Number.isNaN(parsed.getTime())) dueDate = parsed;
    }
  }

  if (!dueDate) {
    const dayMonthMatch = take(new RegExp(`\\b(\\d{1,2}) de (${MONTH_PATTERN})(?: de (\\d{4}))?\\b`, 'i'));
    if (dayMonthMatch) {
      const day = Number(dayMonthMatch[1]);
      const month = MONTH_NAMES.indexOf(normalizeWord(dayMonthMatch[2]) as (typeof MONTH_NAMES)[number]);
      const year = dayMonthMatch[3] ? Number(dayMonthMatch[3]) : now.getFullYear();
      const parsed = new Date(year, month === -1 ? now.getMonth() : month, day);

      if (!dayMonthMatch[3] && parsed.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
        parsed.setFullYear(year + 1);
      }
      dueDate = parsed;
    }
  }

  if (!dueDate) {
    const relativeMatch = take(/\ben (\d+|un|una) (d[ií]as?|semanas?|mes(?:es)?)\b/i);
    if (relativeMatch) {
      const rawCount = normalizeWord(relativeMatch[1]);
      const count = rawCount === 'un' || rawCount === 'una' ? 1 : Number(rawCount);
      const unit = normalizeWord(relativeMatch[2]);
      dueDate = unit.startsWith('dia')
        ? addDays(now, count)
        : unit.startsWith('semana')
          ? addWeeks(now, count)
          : addMonths(now, count);
    }
  }

  if (!dueDate) {
    const keyword = take(/\b(pasado ma[nñ]ana|ma[nñ]ana|hoy)\b/i);
    if (keyword) {
      const value = normalizeWord(keyword[0]);
      if (value === 'hoy') dueDate = now;
      else if (value === 'manana') dueDate = addDays(now, 1);
      else dueDate = addDays(now, 2);
    }
  }

  if (!dueDate) {
    const namedDay = take(new RegExp(`\\b(?:el |este |proximo |próximo )?(${WEEKDAY_PATTERN})\\b`, 'i'));
    if (namedDay) {
      const index = WEEKDAY_NAMES.indexOf(normalizeWord(namedDay[1]) as (typeof WEEKDAY_NAMES)[number]);
      if (index >= 0) dueDate = nextWeekday(now, index);
    }
  }

  if (!dueDate) {
    const bareDay = take(/\bel (\d{1,2})\b/);
    if (bareDay) dueDate = nextDayOfMonth(now, Number(bareDay[1]));
  }

  // -------------------------------------------------------------------------
  // Time — after the date, so "mañana 10:00" keeps both halves.
  // -------------------------------------------------------------------------
  let dueTime: string | null = null;

  // The ranges are baked into the patterns rather than checked afterwards:
  // "algo 99:99" is not a time, so those characters must stay in the title
  // instead of being silently dropped.
  const colonTime = take(/\b(?:a las |las |de la |a la )?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (colonTime) {
    dueTime = `${String(Number(colonTime[1])).padStart(2, '0')}:${colonTime[2]}`;
  }

  if (!dueTime) {
    const hourSuffix = take(/\b([01]?\d|2[0-3])h([0-5]\d)?\b/i);
    if (hourSuffix) {
      dueTime = `${String(Number(hourSuffix[1])).padStart(2, '0')}:${hourSuffix[2] ?? '00'}`;
    }
  }

  if (!dueTime) {
    const spokenTime = take(/\ba las ([01]?\d|2[0-3])\b/);
    if (spokenTime) {
      dueTime = `${String(Number(spokenTime[1])).padStart(2, '0')}:00`;
    }
  }

  // -------------------------------------------------------------------------
  // Priority
  // -------------------------------------------------------------------------
  let priority: TaskPriorityValue = 'none';

  // Several notations can appear at once ("p1 ... !urgente"). The first one
  // sets the level; the rest are still consumed, so nothing is left behind in
  // the title.
  const PRIORITY_PATTERNS = [
    /\b(?:prioridad|prio)\s+(urgente|alta|alto|normal|media|medio|baja|bajo)\b/i,
    /\bp([1-4])\b/i,
    / !(urgente|alta|alto|normal|media|medio|baja|bajo)\b/i,
    / !([1-4])\b/,
  ];

  for (let guard = 0; guard < 5; guard += 1) {
    let found: RegExpMatchArray | null = null;

    for (const pattern of PRIORITY_PATTERNS) {
      found = take(pattern);
      if (found) break;
    }

    if (!found) break;

    if (priority === 'none') {
      const token = normalizeWord(found[1]);
      priority = PRIORITY_CODES[token] ?? PRIORITY_WORDS[token] ?? 'none';
    }
  }

  // -------------------------------------------------------------------------
  // Project and labels
  // -------------------------------------------------------------------------
  const projectMatch = take(/#([\p{L}\p{N}_.-]+)/u);
  const projectQuery = projectMatch ? projectMatch[1] : null;

  const labelQueries: string[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const labelMatch = take(/@([\p{L}\p{N}_.-]+)/u);
    if (!labelMatch) break;
    labelQueries.push(labelMatch[1]);
  }

  // -------------------------------------------------------------------------
  // Result
  // -------------------------------------------------------------------------
  const leftover = text.replace(/\s+/g, ' ').trim();
  const title = leftover.length > 0 ? leftover : original;

  if (dueDate) hints.push(formatDateOnly(dueDate));
  if (dueTime) hints.push(dueTime);
  if (priority !== 'none') hints.push(PRIORITY_LABELS[priority]);
  if (projectQuery) hints.push(`#${projectQuery}`);
  for (const label of labelQueries) hints.push(`@${label}`);
  if (rule) hints.push(describeRecurrence(rule));

  return {
    title,
    dueDate: dueDate ? formatDateOnly(dueDate) : null,
    dueTime,
    priority,
    projectQuery,
    labelQueries,
    recurrence: rule ? formatRecurrence(rule) : null,
    hints,
  };
}

/**
 * True when the capture carries more than a title.
 *
 * Used to decide whether the preview is worth showing at all.
 */
export function hasCaptureDetail(capture: Capture): boolean {
  return (
    capture.dueDate !== null ||
    capture.priority !== 'none' ||
    capture.projectQuery !== null ||
    capture.labelQueries.length > 0 ||
    capture.recurrence !== null
  );
}
