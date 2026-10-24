import { getBaseUrl } from '@/lib/base-url';
import { buildOpenApi } from '@/lib/openapi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/openapi.json
 *
 * Public on purpose: it describes the shape of the API, not its data, and it is
 * what you paste into an HTTP client to get every endpoint without typing them.
 * The `servers` entry follows the origin the request came in by (LAN IP,
 * Tailscale name…), so the file is usable whichever door you opened.
 */
export async function GET() {
  const spec = buildOpenApi(await getBaseUrl());

  return Response.json(spec, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
