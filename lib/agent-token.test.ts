import { describe, expect, it } from 'vitest';

import {
  FULL_ACCESS_SCOPES,
  hasScope,
  isAgentScope,
  looksLikeAgentToken,
  parseBearerToken,
  tokenDisplayPrefix,
} from '@/lib/agent-token';

describe('parseBearerToken', () => {
  it('reads a well-formed header', () => {
    expect(parseBearerToken('Bearer agt_abc123')).toBe('agt_abc123');
  });

  it('is case-insensitive on the scheme', () => {
    expect(parseBearerToken('bearer agt_abc123')).toBe('agt_abc123');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseBearerToken('  Bearer   agt_abc123  ')).toBe('agt_abc123');
  });

  it('rejects a missing header', () => {
    expect(parseBearerToken(null)).toBeNull();
  });

  it('rejects another scheme', () => {
    expect(parseBearerToken('Basic agt_abc123')).toBeNull();
  });

  it('rejects an empty token', () => {
    expect(parseBearerToken('Bearer    ')).toBeNull();
  });
});

describe('looksLikeAgentToken', () => {
  it('accepts a token with the right prefix and enough entropy', () => {
    expect(looksLikeAgentToken('agt_' + 'a'.repeat(43))).toBe(true);
  });

  it('rejects a token with the wrong prefix', () => {
    expect(looksLikeAgentToken('sk_' + 'a'.repeat(43))).toBe(false);
  });

  it('rejects a short token', () => {
    expect(looksLikeAgentToken('agt_short')).toBe(false);
  });
});

describe('hasScope', () => {
  it('grants an explicit scope', () => {
    expect(hasScope(['tasks:read'], 'tasks:read')).toBe(true);
  });

  it('does not grant what was not given', () => {
    expect(hasScope(['tasks:read'], 'tasks:write')).toBe(false);
  });

  it('lets write imply read', () => {
    expect(hasScope(['tasks:write'], 'tasks:read')).toBe(true);
  });

  it('does not let read imply write', () => {
    expect(hasScope(['tasks:read'], 'tasks:write')).toBe(false);
  });

  it('honours the wildcard', () => {
    expect(hasScope(['*'], 'runs:write')).toBe(true);
  });

  it('keeps read implication inside the same area', () => {
    expect(hasScope(['tasks:write'], 'notes:read')).toBe(false);
  });

  it('works with the full-access set', () => {
    for (const scope of FULL_ACCESS_SCOPES) {
      expect(hasScope(FULL_ACCESS_SCOPES, scope)).toBe(true);
    }
  });
});

describe('isAgentScope', () => {
  it('recognises a known scope', () => {
    expect(isAgentScope('runs:write')).toBe(true);
  });

  it('rejects an unknown one', () => {
    expect(isAgentScope('runs:destroy')).toBe(false);
  });
});

describe('tokenDisplayPrefix', () => {
  it('keeps only the beginning of the token', () => {
    const raw = 'agt_abcdefghijklmnopqrstuvwxyz0123456789';
    expect(tokenDisplayPrefix(raw)).toBe('agt_abcdefgh');
    expect(tokenDisplayPrefix(raw).length).toBeLessThan(raw.length);
  });
});
