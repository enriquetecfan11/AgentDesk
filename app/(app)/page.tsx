import { redirect } from 'next/navigation';

export default function RootPage() {
  // The workspace opens on the day view once Fase 3 lands; until then, tasks.
  redirect('/tasks');
}
