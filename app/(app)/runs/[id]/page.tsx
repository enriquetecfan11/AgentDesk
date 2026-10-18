import { notFound } from 'next/navigation';
import { z } from 'zod';

import { RunDetailLive } from '@/components/runs/run-detail';
import { getRunDetail } from '@/lib/domain/runs';

export const dynamic = 'force-dynamic';

/** Detalle de un run: entrada, salida, logs en vivo y artefactos. */
export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const detail = await getRunDetail(id);
  if (!detail) notFound();

  return <RunDetailLive initial={detail} />;
}
