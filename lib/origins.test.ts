import { describe, expect, it } from 'vitest';

import {
  isSecureBaseUrl,
  normalizeOrigin,
  parseOriginList,
  resolveBaseUrl,
  sanitizeHost,
} from '@/lib/origins';

const LAN = 'http://192.168.1.195:3000';
const TAILSCALE = 'http://kikes-mac-mini.bombay-pomano.ts.net:3000';

describe('normalizeOrigin', () => {
  it('keeps scheme, host and port and drops a trailing slash', () => {
    expect(normalizeOrigin('http://192.168.1.195:3000/')).toBe(LAN);
  });

  it('lowercases the host', () => {
    expect(normalizeOrigin('HTTP://Kikes-Mac-Mini.LOCAL:3000')).toBe(
      'http://kikes-mac-mini.local:3000',
    );
  });

  it('rejects paths, queries, credentials and non-http schemes', () => {
    expect(normalizeOrigin('http://host:3000/app')).toBeNull();
    expect(normalizeOrigin('http://host:3000?x=1')).toBeNull();
    expect(normalizeOrigin('http://user:pass@host:3000')).toBeNull();
    expect(normalizeOrigin('ftp://host:3000')).toBeNull();
    expect(normalizeOrigin('192.168.1.195:3000')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });
});

describe('parseOriginList', () => {
  it('splits, trims, normalizes and drops duplicates and blanks', () => {
    expect(parseOriginList(` ${LAN}/ , ${TAILSCALE},, ${LAN}`)).toEqual([LAN, TAILSCALE]);
  });

  it('returns an empty list for missing values', () => {
    expect(parseOriginList(undefined)).toEqual([]);
    expect(parseOriginList('')).toEqual([]);
  });
});

describe('sanitizeHost', () => {
  it('accepts host, host:port and IPv6 literals', () => {
    expect(sanitizeHost('192.168.1.195:3000')).toBe('192.168.1.195:3000');
    expect(sanitizeHost('Kikes-Mac-Mini.local:3000')).toBe('kikes-mac-mini.local:3000');
    expect(sanitizeHost('[fd7a:115c:a1e0::1]:3000')).toBe('[fd7a:115c:a1e0::1]:3000');
  });

  it('uses the first value when the header is repeated', () => {
    expect(sanitizeHost('host:3000, other:3000')).toBe('host:3000');
  });

  it('rejects values that could break out of the URL', () => {
    expect(sanitizeHost('evil.com/path')).toBeNull();
    expect(sanitizeHost('evil.com x')).toBeNull();
    expect(sanitizeHost('http://evil.com')).toBeNull();
    expect(sanitizeHost('')).toBeNull();
    expect(sanitizeHost(undefined)).toBeNull();
  });
});

describe('resolveBaseUrl', () => {
  it('returns the origin the request came in by when it is declared', () => {
    expect(
      resolveBaseUrl({
        canonical: LAN,
        extra: `${TAILSCALE},http://other:3000`,
        host: 'kikes-mac-mini.bombay-pomano.ts.net:3000',
        proto: 'http',
      }),
    ).toBe(TAILSCALE);
  });

  it('returns the canonical URL for an undeclared Host', () => {
    expect(
      resolveBaseUrl({ canonical: LAN, extra: TAILSCALE, host: 'evil.example:3000', proto: 'http' }),
    ).toBe(LAN);
  });

  it('ignores an undeclared scheme', () => {
    expect(
      resolveBaseUrl({
        canonical: LAN,
        extra: TAILSCALE,
        host: 'kikes-mac-mini.bombay-pomano.ts.net:3000',
        proto: 'https',
      }),
    ).toBe(LAN);
  });

  it('falls back to the canonical URL without headers', () => {
    expect(resolveBaseUrl({ canonical: LAN })).toBe(LAN);
    expect(resolveBaseUrl({ canonical: LAN, host: null, proto: null })).toBe(LAN);
  });

  it('uses the first x-forwarded-proto value', () => {
    expect(resolveBaseUrl({ canonical: LAN, host: '192.168.1.195:3000', proto: 'http, https' })).toBe(
      LAN,
    );
  });

  it('never echoes an injected Host, even when it matches the port', () => {
    expect(
      resolveBaseUrl({ canonical: LAN, host: 'evil.com\\@192.168.1.195:3000', proto: 'http' }),
    ).toBe(LAN);
  });

  it('keeps an https extra origin when proxied over TLS', () => {
    const secure = 'https://agentdesk.example.ts.net';
    expect(
      resolveBaseUrl({
        canonical: LAN,
        extra: secure,
        host: 'agentdesk.example.ts.net',
        proto: 'https',
      }),
    ).toBe(secure);
  });
});

describe('isSecureBaseUrl', () => {
  it('only treats https as secure', () => {
    expect(isSecureBaseUrl('https://host:3000')).toBe(true);
    expect(isSecureBaseUrl('http://host:3000')).toBe(false);
  });
});
