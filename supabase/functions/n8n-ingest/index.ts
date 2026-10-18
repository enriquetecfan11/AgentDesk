/*
# n8n ingest webhook edge function

Incoming webhook for registered n8n automations. Each automation has a secret (generated in the
UI when registering the automation) stored hashed in `automations.secret_hash`. n8n calls:

  POST /functions/v1/n8n-ingest
  Header: X-N8N-Secret: <secret>
  Body: { action: "create_task" | "update_task", ...payload }

Actions:
- create_task: { title, description?, priority?, due_date?, project_name? }
- update_task: { task_id, status?, priority?, due_date? }
- list_tasks:  {} -> non-done tasks (so workflows can decide what to update)

Permission model: `automations.permissions` jsonb (create_task, update_task, read_tasks).
Every invocation is logged in `automations_log` and produces a timeline event attributed to the
automation's actor.

CORS: none. The only caller is n8n, authenticating with a shared secret header, which is not
a browser credential, so no cross-origin surface is needed.

Secret handling: X-N8N-Secret is hashed with sha256 and matched against
automations.secret_hash, which is indexed. The plaintext secret is shown once at
registration and is never stored or logged. secret_hash is not selectable by the anon role,
so a leaked browser key cannot be used to mint a valid secret.

Outbound webhook (SSRF): automations.output_webhook_url causes a server-side fetch, so it
is treated as untrusted input. Before fetching we require https, resolve the hostname and
reject loopback, RFC1918, link-local, carrier-grade-NAT, multicast, reserved and IPv6
unique-local ranges. Redirects are refused rather than followed, since a redirect is the
obvious way around a check performed on the first URL. This is best-effort: the address the
runtime actually connects to can differ from the DNS answer we validated.

Input limits: titles capped at 300 characters, free text at 20k, every field type-checked.
Validation failures return 400; database errors are logged server-side and answered with
an opaque 500.
*/

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

const MAX_TITLE = 300;
const MAX_TEXT = 20000;

/** Caller-safe validation failure; anything else is treated as internal. */
class ValidationError extends Error {}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length <= max ? value : null;
}

function requiredStr(value: unknown, max: number, field: string): string {
  const s = str(value, max);
  if (s === null || !s.trim()) throw new ValidationError(`${field} must be a non-empty string under ${max} characters`);
  return s.trim();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function dbErr(e: unknown, context: string): Response {
  console.error(context, e);
  return err('Internal error', 500);
}

// ============ Outbound webhook SSRF guard ============

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return true;
  const nums = parts.map((p) => {
    // Reject non-canonical forms such as 0177 or 0x7f outright rather than
    // guessing at the intended value.
    if (!/^(0|[1-9]\d{0,2})$/.test(p)) return Number.NaN;
    return Number(p);
  });
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = nums;
  if (a === 0 || a === 127) return true;                 // this network, loopback
  if (a === 10) return true;                             // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;      // RFC1918
  if (a === 192 && b === 168) return true;               // RFC1918
  if (a === 169 && b === 254) return true;               // link-local, cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
  if (a === 192 && b === 0) return true;                 // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
  if (a >= 224) return true;                             // multicast + reserved
  return false;
}

/** Expands any IPv6 textual form, including `::` compression and embedded IPv4, to 16 bytes. */
function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (!s.includes(':')) return null;

  if (s.includes('.')) {
    const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (!m) return null;
    const v4 = m[2].split('.').map(Number);
    if (v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = m[1] + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;

  const groups = [...head, ...new Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

function isBlockedAddress(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (addr.includes(':')) {
    const b = parseIPv6(addr);
    if (!b) return true;                                  // unparseable -> refuse
    if (b.every((x) => x === 0)) return true;            // :: unspecified
    if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;  // ::1 loopback
    if ((b[0] & 0xfe) === 0xfc) return true;              // fc00::/7 unique-local
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;  // fe80::/10 link-local

    const v4 = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
    // IPv4-mapped ::ffff:0:0/96. URL parsing rewrites the dotted form to hex
    // (::ffff:127.0.0.1 becomes ::ffff:7f00:1), so this must be read as bytes.
    if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) {
      return isBlockedIpv4(v4);
    }
    // NAT64 well-known prefix 64:ff9b::/96, another way to reach an IPv4 host.
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
      return isBlockedIpv4(v4);
    }
    // 6to4 2002::/16 embeds the IPv4 destination in the following four bytes.
    if (b[0] === 0x20 && b[1] === 0x02) {
      return isBlockedIpv4(`${b[2]}.${b[3]}.${b[4]}.${b[5]}`);
    }
    return false;
  }
  return isBlockedIpv4(addr);
}

async function assertSafeWebhookUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('output_webhook_url is not a valid URL');
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError('output_webhook_url must use https');
  }
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new ValidationError('output_webhook_url points at an internal host');
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isBlockedAddress(host)) throw new ValidationError('output_webhook_url points at a private address');
    return url.toString();
  }

  let records: string[];
  try {
    records = await Deno.resolveDns(host, 'A');
  } catch {
    try {
      records = await Deno.resolveDns(host, 'AAAA');
    } catch {
      throw new ValidationError('output_webhook_url host could not be resolved');
    }
  }
  if (records.length === 0) throw new ValidationError('output_webhook_url host could not be resolved');
  for (const record of records) {
    if (isBlockedAddress(record)) {
      throw new ValidationError('output_webhook_url resolves to a private address');
    }
  }
  return url.toString();
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface AutomationRow {
  id: string;
  name: string;
  status: string;
  permissions: string[];
  actor_id: string | null;
  output_webhook_url: string | null;
}

async function authenticate(req: Request, admin: SupabaseClient): Promise<AutomationRow | null> {
  const secret = req.headers.get('X-N8N-Secret') ?? '';
  if (!secret) return null;
  const secretHash = await sha256Hex(secret);
  const { data } = await admin
    .from('automations')
    .select('id, name, status, permissions, actor_id, output_webhook_url')
    .eq('secret_hash', secretHash)
    .maybeSingle();
  if (!data) return null;
  if ((data as AutomationRow).status !== 'active') return null;
  return data as AutomationRow;
}

Deno.serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let automation: AutomationRow | null = null;
  let action = 'unknown';
  let payload: Record<string, unknown> = {};
  let result: Record<string, unknown> = {};

  try {
    automation = await authenticate(req, admin);
    if (!automation) return err('Unauthorized: invalid or inactive automation secret', 401);

    if (req.method !== 'POST') return err('Method not allowed', 405);

    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== 'string') return err('Missing action');
    action = body.action;
    payload = body;
    const has = (p: string) => (automation!.permissions as string[]).includes(p);

    const logEvent = async (kind: string, entityType: string, entityId: string | null, entityTitle: string | null, p: Record<string, unknown> = {}) => {
      await admin.from('events').insert({
        kind, actor_id: automation!.actor_id, entity_type: entityType, entity_id: entityId, entity_title: entityTitle, payload: p,
      });
    };

    switch (action) {
      case 'create_task': {
        if (!has('create_task')) return err('Missing permission: create_task', 403);
        const title = requiredStr(body.title, MAX_TITLE, 'title');
        let projectId: string | null = null;
        const projectName = str(body.project_name, MAX_TITLE);
        if (projectName && projectName.trim()) {
          // limit(1) rather than maybeSingle(): two projects sharing a name used
          // to turn this into a 500.
          const { data: project } = await admin
            .from('projects')
            .select('id')
            .ilike('name', projectName.trim())
            .order('created_at')
            .limit(1)
            .maybeSingle();
          projectId = project ? (project as { id: string }).id : null;
        }
        const { data: task, error } = await admin
          .from('tasks')
          .insert({
            title,
            description: str(body.description, MAX_TEXT),
            priority: (['urgent', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal') as string,
            due_date: str(body.due_date, 10),
            project_id: projectId,
            origin: 'automation',
            status: 'backlog',
          })
          .select('*')
          .single();
        if (error) throw error;
        result = { task };
        await logEvent('task.created', 'task', (task as { id: string }).id, title, { origin: 'automation', by: automation.name });
        break;
      }

      case 'update_task': {
        if (!has('update_task')) return err('Missing permission: update_task', 403);
        const taskId = requiredStr(body.task_id, 64, 'task_id');
        const patch: Record<string, unknown> = {};
        if (['backlog', 'in_progress', 'review', 'done'].includes(body.status)) {
          patch.status = body.status;
          // completed_at used to be set on 'done' but never cleared when a task
          // moved back off it, leaving a stale completion timestamp.
          patch.completed_at = body.status === 'done' ? new Date().toISOString() : null;
        }
        if (['urgent', 'high', 'normal', 'low'].includes(body.priority)) patch.priority = body.priority;
        const dueDate = str(body.due_date, 10);
        if (dueDate !== null) patch.due_date = dueDate;
        if (Object.keys(patch).length === 0) return err('No valid fields to update');
        const { data: task, error } = await admin
          .from('tasks')
          .update(patch)
          .eq('id', taskId)
          .select('*')
          .single();
        if (error) throw error;
        result = { task };
        await logEvent(`task.status_${body.status ?? 'updated'}`, 'task', taskId, (task as { title: string }).title, { by: automation.name });
        break;
      }

      case 'list_tasks': {
        if (!has('read_tasks')) return err('Missing permission: read_tasks', 403);
        const { data: tasks, error } = await admin
          .from('tasks')
          .select('id, title, status, priority, due_date, project_id, origin')
          .neq('status', 'done')
          .order('created_at', { ascending: false })
          .limit(100);
        if (error) throw error;
        result = { tasks: tasks ?? [] };
        break;
      }

      default:
        return err(`Unknown action: ${action}`);
    }

    await admin.from('automations_log').insert({
      automation_id: automation.id,
      action,
      payload,
      result,
    });

    // Optional outbound trigger: notify the automation's output webhook (fire and forget).
    // The URL is a stored value that becomes a server-side request, so it is validated
    // before use and redirects are refused rather than followed.
    if (automation.output_webhook_url) {
      try {
        const safeUrl = await assertSafeWebhookUrl(automation.output_webhook_url);
        await fetch(safeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'automation_invoked', action, result }),
          redirect: 'error',
        });
      } catch (webhookError) {
        console.error('output webhook skipped or failed', webhookError);
      }
    }

    return json(result);
  } catch (e) {
    if (e instanceof ValidationError) return err(e.message, 400);
    return dbErr(e, 'n8n-ingest error');
  }
});
