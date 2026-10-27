import { parseBearerToken } from '@/lib/agent-token';
import { requireAgent } from '@/lib/auth/agent';
import { HttpError, json, readJson, route } from '@/lib/api/http';
import { handlersFor, toolNames } from '@/lib/mcp';
import { handleIncoming, SERVER_NAME, SERVER_VERSION } from '@/lib/mcp/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * CORS for browser clients (the dashboard at localhost:5173, or the Pi at
 * :4173). A wildcard origin is safe here because auth is a Bearer token, never
 * a cookie: opening the origin does not open the data. The headers go on every
 * response, not just the preflight — a browser rejects the real response too if
 * they are missing, and that includes the 401/403 the dashboard needs to read.
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, POST',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
  'Access-Control-Max-Age': '300',
};

/** Stamps the CORS headers onto any response, streamed or not. */
function withCors(response: Response): Response {
  for (const [name, value] of Object.entries(corsHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

/** Preflight: no token is sent on an OPTIONS, so it must not require one. */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/mcp — the MCP server, over Streamable HTTP.
 *
 * It lives in the app rather than in a container of its own, so a tool call
 * reaches the domain layer directly: one process, one port, one place where a
 * new tool has to be registered. The standalone `mcp/agentdesk-mcp.mjs` is now
 * only a stdio bridge onto this endpoint, for clients that still need a child
 * process.
 *
 * Auth is the agent Bearer token and the scopes that already exist. No scope
 * is demanded here: each tool declares its own and checks it, so a token with
 * only `tasks:read` can still complete the handshake, list the catalogue and
 * read the `403` as text instead of failing to connect at all.
 */
export async function POST(request: Request) {
  return withCors(await route(async () => {
    const actor = await requireAgent(request);
    const payload = await readJson(request);
    const responses = await handleIncoming(payload, handlersFor(actor));

    // Notifications only: nothing to say back.
    if (responses.length === 0) return new Response(null, { status: 202 });

    // Clients that ask for a stream get SSE frames; the rest get plain JSON.
    // Both are valid Streamable HTTP, and the second is far easier to curl.
    const wantsStream = (request.headers.get('accept') ?? '').includes('text/event-stream');

    if (!wantsStream) {
      return json(responses.length === 1 ? responses[0] : responses);
    }

    const body = responses
      .map((response) => `event: message\ndata: ${JSON.stringify(response)}\n\n`)
      .join('');

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }));
}

/**
 * GET /api/mcp
 *
 * There is no server-initiated stream here: AgentDesk already has one at
 * `/api/v1/events`, and a second channel saying the same things would be two
 * places to keep in sync. A GET answers with what the endpoint is instead of a
 * bare 405, because that is what someone who opened the URL in a browser
 * needs to read.
 */
export async function GET(request: Request) {
  return withCors(await route(async () => {
    // A token is not required to read this, but if one was sent it has to be
    // valid: half-working credentials are worth saying out loud.
    if (parseBearerToken(request.headers.get('authorization'))) {
      await requireAgent(request);
    }

    throw new HttpError(405, 'Usa POST /api/mcp con un mensaje JSON-RPC 2.0', {
      server: SERVER_NAME,
      version: SERVER_VERSION,
      transport: 'streamable-http',
      tools: toolNames(),
      events: '/api/v1/events',
    });
  }));
}
