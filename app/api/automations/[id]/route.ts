import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** https only, and never an internal address: this value becomes a server-side fetch. */
function validateWebhookUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('output_webhook_url must be a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('output_webhook_url must use https');
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === '::1' ||
    host === '[::1]' ||
    host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')
  ) {
    throw new Error('output_webhook_url must not point at a private or internal address');
  }
  return url.toString();
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return failure('Invalid automation id', 400);

  let body: { status?: unknown; output_webhook_url?: unknown };
  try {
    body = await request.json();
  } catch {
    return failure('Invalid JSON body', 400);
  }

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'paused') {
      return failure('status must be active or paused', 400);
    }
    patch.status = body.status;
  }
  if (body.output_webhook_url !== undefined) {
    if (typeof body.output_webhook_url !== 'string') {
      return failure('output_webhook_url must be a string', 400);
    }
    try {
      patch.output_webhook_url = body.output_webhook_url === '' ? null : validateWebhookUrl(body.output_webhook_url);
    } catch (e) {
      return failure(e instanceof Error ? e.message : 'Invalid output_webhook_url', 400);
    }
  }
  if (Object.keys(patch).length === 0) return failure('No valid fields to update', 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return failure('Service unavailable', 500);

  try {
    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await db.from('automations').update(patch).eq('id', params.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('update automation failed', e);
    return failure('Failed to update automation', 500);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return failure('Invalid automation id', 400);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return failure('Service unavailable', 500);

  try {
    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await db.from('automations').select('actor_id').eq('id', params.id).maybeSingle();
    if (error) throw error;
    if (!data) return failure('Automation not found', 404);

    const { error: delError } = await db.from('automations').delete().eq('id', params.id);
    if (delError) throw delError;

    const actorId = (data as { actor_id: string | null }).actor_id;
    if (actorId) await db.from('actors').delete().eq('id', actorId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('delete automation failed', e);
    return failure('Failed to delete automation', 500);
  }
}