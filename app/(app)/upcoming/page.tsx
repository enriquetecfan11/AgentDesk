import { ComingSoon } from '@/components/shell/coming-soon';

export default function UpcomingPage() {
  return (
    <ComingSoon
      title="Próximas"
      phase={3}
      description="Vista de calendario de los próximos días, agrupada por fecha y con las recurrencias ya expandidas."
    />
  );
}
