import { NextResponse } from 'next/server';
import { createAutomationWithSecret } from '@/lib/agents-server';

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Create an n8n automation and return its webhook secret exactly once.
 *
 * Server-side because it needs the service role key: `anon` can no longer
 * insert into `automations` (migration 20261018120000).
 */
export async function POST(request: Request) {
  let body: { name?: unknown; description?: unknown; permissions?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure('Invalid JSON body', 400);
  }

  if (typeof body.name !== 'string') return failure('name is required', 400);
  if (body.description !== null && body.description !== undefined && typeof body.description !== 'string') {
    return failure('description must be a string', 400);
  }
  if (body.permissions !== undefined) {
    if (!Array.isArray(body.permissions) || body.permissions.some((p) => typeof p !== 'string')) {
      return failure('permissions must be an array of strings', 400);
    }
  }

  try {
    const result = await createAutomationWithSecret({
      name: body.name,
      description: (body.description as string | null | undefined) ?? null,
      permissions: body.permissions as string[] | undefined,
    });
    return NextResponse.json(
      { automationId: result.automationId, actorId: result.actorId, secret: result.secret },
      { status: 201 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (/required|exceeds|no valid permissions/.test(message)) return failure(message, 400);
    console.error('create automation failed', e);
    return failure('Failed to create automation', 500);
  }
}