import { ComingSoon } from '@/components/shell/coming-soon';

export default function TodayPage() {
  return (
    <ComingSoon
      title="Hoy"
      phase={3}
      description="Las tareas con fecha de hoy o vencidas, más lo que toca repetir según su recurrencia."
    />
  );
}
