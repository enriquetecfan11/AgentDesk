import { getSql } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness probe used by the Docker healthcheck and by
 * `scripts/verify.sh`. It touches the database so a dead pool fails the check.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await getSql()`select 1`;
    return Response.json(
      {
        status: 'ok',
        services: { app: 'ok', db: 'ok' },
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[health] database unreachable', error);
    return Response.json(
      {
        status: 'error',
        services: { app: 'ok', db: 'unreachable' },
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
