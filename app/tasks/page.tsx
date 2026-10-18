import { Suspense } from 'react';
import { TasksView } from '@/components/views/tasks-view';

export default function TasksPage() {
  return (
    <Suspense>
      <TasksView />
    </Suspense>
  );
}
