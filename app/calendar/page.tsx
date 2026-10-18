import { Suspense } from 'react';
import { CalendarView } from '@/components/views/calendar-view';

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarView />
    </Suspense>
  );
}
