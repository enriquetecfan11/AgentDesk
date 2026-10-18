import { describe, expect, it } from 'vitest';

import {
  buildSignatureHeader,
  generateWebhookSecret,
  parseSignatureHeader,
  signWebhookPayload,
  verifyWebhookSignature,
} from '@/lib/webhook-signature';
import { webhookSecretPreview } from '@/lib/webhook';

const SECRET = 'whsec_de-prueba-para-los-tests-0123456789';
const BODY = JSON.stringify({ event: 'task.changed', data: { id: 'abc' } });
const AT = 1_730_000_000;

describe('generateWebhookSecret', () => {
  it('carries the right prefix', () => {
    expect(generateWebhookSecret().startsWith('whsec_')).toBe(true);
  });

  it('is long and unique', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(b);
  });
});

describe('webhookSecretPreview', () => {
  it('keeps only the beginning', () => {
    expect(webhookSecretPreview(SECRET)).toBe('whsec_de-pru…');
  });
});

describe('signWebhookPayload', () => {
  it('is deterministic', () => {
    expect(signWebhookPayload(SECRET, AT, BODY)).toBe(signWebhookPayload(SECRET, AT, BODY));
  });

  it('changes with the body', () => {
    expect(signWebhookPayload(SECRET, AT, BODY)).not.toBe(signWebhookPayload(SECRET, AT, `${BODY} `));
  });

  it('changes with the timestamp, so a captured body cannot be replayed', () => {
    expect(signWebhookPayload(SECRET, AT, BODY)).not.toBe(signWebhookPayload(SECRET, AT + 1, BODY));
  });

  it('changes with the secret', () => {
    expect(signWebhookPayload(SECRET, AT, BODY)).not.toBe(signWebhookPayload('whsec_otro', AT, BODY));
  });

  it('is a sha256 in hex', () => {
    expect(signWebhookPayload(SECRET, AT, BODY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('parseSignatureHeader', () => {
  it('reads both fields back', () => {
    expect(parseSignatureHeader(`t=${AT},v1=abc`)).toEqual({ timestamp: AT, signature: 'abc' });
  });

  it('tolerates whitespace and unknown fields', () => {
    expect(parseSignatureHeader(` t=${AT} , v1=abc , v2=xyz`)).toEqual({
      timestamp: AT,
      signature: 'abc',
    });
  });

  it('rejects a header with no version', () => {
    expect(parseSignatureHeader(`t=${AT}`)).toBeNull();
  });

  it('rejects a header with no timestamp', () => {
    expect(parseSignatureHeader('v1=abc')).toBeNull();
  });

  it('rejects a non-numeric timestamp', () => {
    expect(parseSignatureHeader('t=ayer,v1=abc')).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a signature it just produced', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header: buildSignatureHeader(SECRET, BODY, AT),
        body: BODY,
        now: AT,
      }),
    ).toBe(true);
  });

  it('rejects a missing header', () => {
    expect(verifyWebhookSignature({ secret: SECRET, header: null, body: BODY, now: AT })).toBe(false);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header: buildSignatureHeader(SECRET, BODY, AT),
        body: `${BODY} `,
        now: AT,
      }),
    ).toBe(false);
  });

  it('rejects another secret', () => {
    expect(
      verifyWebhookSignature({
        secret: 'whsec_otro',
        header: buildSignatureHeader(SECRET, BODY, AT),
        body: BODY,
        now: AT,
      }),
    ).toBe(false);
  });

  it('rejects a stale request', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header: buildSignatureHeader(SECRET, BODY, AT),
        body: BODY,
        now: AT + 3600,
      }),
    ).toBe(false);
  });

  it('rejects a request from the future', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header: buildSignatureHeader(SECRET, BODY, AT),
        body: BODY,
        now: AT - 3600,
      }),
    ).toBe(false);
  });

  it('accepts a clock skew inside the tolerance', () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        header: buildSignatureHeader(SECRET, BODY, AT),
        body: BODY,
        now: AT + 120,
      }),
    ).toBe(true);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, header: `t=${AT},v1=corto`, body: BODY, now: AT }),
    ).toBe(false);
  });
});
