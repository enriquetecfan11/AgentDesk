import { getEnv } from '@/lib/env';
import { buildOpenApi } from '@/lib/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/openapi.json
 *
 * Public on purpose: it describes the shape of the API, not its data, and it is
 * what you paste into an HTTP client to get every endpoint without typing them.
 * The `servers` entry comes from `APP_BASE_URL`, so the same file works from any
 * machine on the LAN.
 */
export function GET() {
  const spec = buildOpenApi(getEnv().APP_BASE_URL);

  return Response.json(spec, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
