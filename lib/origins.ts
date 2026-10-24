/**
 * Pure helpers to turn a request's Host / X-Forwarded-* headers into a base URL.
 *
 * The app can be reached from more than one origin: the LAN IP the browser
 * types, and a stable name such as a Tailscale MagicDNS host. APP_BASE_URL is
 * the canonical one; any extra origin must be declared explicitly, because a
 * Host header is attacker-controlled and must never be echoed back unchecked.
 *
 * Kept free of `next/headers` and env access so it can be unit tested.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Canonical form of an origin (`https://host:port`), or null when the value is
 * not a bare http(s) origin.
 *
 * Rejects paths, queries, credentials and fragments: this value ends up in
 * absolute links and in the cookie policy, so a malformed entry must fail
 * loudly instead of half-working.
 */
export function normalizeOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
  if (!url.hostname) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;

  return url.origin.toLowerCase();
}

/** Parses a comma-separated list of origins, dropping blanks and duplicates. */
export function parseOriginList(value: string | null | undefined): string[] {
  if (!value) return [];

  const seen = new Set<string>();
  for (const entry of value.split(',')) {
    const origin = normalizeOrigin(entry);
    if (origin) seen.add(origin);
  }

  return [...seen];
}

/**
 * A Host header is only usable when it looks like `host` or `host:port`
 * (IPv6 literals included). Anything with whitespace, slashes or other
 * delimiter characters is dropped rather than pasted into a URL.
 */
export function sanitizeHost(value: string | null | undefined): string | null {
  if (!value) return null;

  const host = value.split(',')[0].trim();
  if (!host || host.length > 255) return null;
  if (!/^[A-Za-z0-9.\-:[\]]+$/.test(host)) return null;

  return host.toLowerCase();
}

export type ResolveBaseUrlOptions = {
  /** APP_BASE_URL: the canonical origin, used when the request host is unknown. */
  canonical: string;
  /** APP_EXTRA_ORIGINS, comma separated. */
  extra?: string | null;
  /** Host / X-Forwarded-Host header. */
  host?: string | null;
  /** X-Forwarded-Proto header. */
  proto?: string | null;
};

/**
 * The base URL to use for this request: the request's own origin when it is an
 * allowed one (so links keep working whether you came in by LAN IP or by
 * Tailscale name), otherwise the canonical APP_BASE_URL.
 */
export function resolveBaseUrl(options: ResolveBaseUrlOptions): string {
  const canonical = normalizeOrigin(options.canonical) ?? options.canonical;
  const allowed = new Set([canonical.toLowerCase(), ...parseOriginList(options.extra)]);

  const canonicalProtocol = (() => {
    try {
      return new URL(canonical).protocol.replace(':', '');
    } catch {
      return 'http';
    }
  })();

  const proto = (options.proto ?? '').split(',')[0].trim().toLowerCase() || canonicalProtocol;
  const host = sanitizeHost(options.host);
  if (!host || !ALLOWED_PROTOCOLS.has(`${proto}:`)) return canonical;

  const candidate = normalizeOrigin(`${proto}://${host}`);
  return candidate && allowed.has(candidate) ? candidate : canonical;
}

/** True when this base URL is served over HTTPS, which decides cookie `Secure`. */
export function isSecureBaseUrl(baseUrl: string): boolean {
  return baseUrl.startsWith('https://');
}
