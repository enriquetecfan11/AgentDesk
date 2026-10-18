import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Dates from the API are plain `YYYY-MM-DD` strings with no timezone.
 * They must be parsed as LOCAL midnight, otherwise a negative UTC offset
 * silently shifts every task to the previous day.
 */
export function parseDateOnly(value: string): Date {
  return parseISO(`${value}T00:00:00`);
}

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function formatDateOnly(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function formatDueLabel(dueDate: string, dueTime?: string | null): string {
  const date = parseDateOnly(dueDate);
  const days = differenceInCalendarDays(date, new Date());

  const time = dueTime ? ` ${dueTime.slice(0, 5)}` : '';

  if (days === 0) return `Hoy${time}`;
  if (days === 1) return `Mañana${time}`;
  if (days === -1) return `Ayer${time}`;
  if (days > 1 && days < 7) return `${format(date, 'EEEE', { locale: es })}${time}`;
  if (date.getFullYear() === new Date().getFullYear()) {
    return `${format(date, 'd MMM', { locale: es })}${time}`;
  }
  return `${format(date, 'd MMM yyyy', { locale: es })}${time}`;
}

export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate) return false;
  if (status === 'done' || status === 'cancelled') return false;
  return differenceInCalendarDays(parseDateOnly(dueDate), new Date()) < 0;
}

export function formatTimestamp(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, HH:mm", { locale: es });
}

export function formatRelative(iso: string): string {
  const date = new Date(iso);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'hace unos segundos';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = differenceInCalendarDays(new Date(), date);
  if (days < 7) return `hace ${days} d`;
  return formatTimestamp(iso);
}
