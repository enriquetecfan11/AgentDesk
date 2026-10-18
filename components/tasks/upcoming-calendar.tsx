'use client';

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatDateOnly, parseDateOnly, todayIso } from '@/lib/dates';
import type { TaskDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/**
 * Month grid with a dot per day that has work.
 *
 * Weeks start on Monday, which is what a Spanish calendar looks like. Days
 * outside the current month stay visible (greyed) so the grid keeps its shape.
 */
export function UpcomingCalendar({
  tasks,
  selectedDay,
  onSelectDay,
}: {
  tasks: TaskDTO[];
  selectedDay: string;
  onSelectDay: (iso: string) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(parseDateOnly(selectedDay)));
  const today = todayIso();

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      map.set(task.dueDate, (map.get(task.dueDate) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
      }),
    [month],
  );

  return (
    <div className="border-b border-border px-3 py-3">
      <div className="mb-2 flex items-center gap-1">
        <h2 className="text-sm font-medium capitalize">
          {month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setMonth(startOfMonth(new Date()));
              onSelectDay(today);
            }}
          >
            Hoy
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setMonth((current) => addMonths(current, -1))}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setMonth((current) => addMonths(current, 1))}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((label) => (
          <div key={label} className="pb-1 text-center text-[11px] text-muted-foreground">
            {label}
          </div>
        ))}

        {days.map((day) => {
          const iso = formatDateOnly(day);
          const count = counts.get(iso) ?? 0;
          const isSelected = iso === selectedDay;
          const inMonth = isSameMonth(day, month);
          const isToday = iso === today;

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDay(iso)}
              aria-pressed={isSelected}
              aria-label={`${day.toLocaleDateString('es-ES', { dateStyle: 'full' })}, ${count} tareas`}
              className={cn(
                'relative grid h-9 place-items-center rounded-md text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted',
                isToday && !isSelected && 'ring-1 ring-inset ring-accent/50',
              )}
            >
              {day.getDate()}

              {count > 0 && (
                <span
                  className={cn(
                    'absolute bottom-1 size-1 rounded-full',
                    isSelected ? 'bg-accent-foreground' : 'bg-accent',
                  )}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
