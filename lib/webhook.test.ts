import { describe, expect, it } from 'vitest';

import {
  isWebhookEvent,
  isWebhookPattern,
  matchesWebhookEvent,
  QUIET_WEBHOOK_EVENTS,
  WEBHOOK_EVENT_NAMES,
  webhookEventLabel,
} from '@/lib/webhook';

describe('matchesWebhookEvent', () => {
  it('matches an exact subscription', () => {
    expect(matchesWebhookEvent(['task.changed'], 'task.changed')).toBe(true);
  });

  it('does not match a different event', () => {
    expect(matchesWebhookEvent(['task.changed'], 'note.changed')).toBe(false);
  });

  it('matches everything with the wildcard', () => {
    expect(matchesWebhookEvent(['*'], 'run.log')).toBe(true);
  });

  it('matches a whole family with a prefix', () => {
    expect(matchesWebhookEvent(['task.*'], 'task.changed')).toBe(true);
    expect(matchesWebhookEvent(['task.*'], 'task.comment')).toBe(true);
  });

  it('keeps a prefix inside its family', () => {
    expect(matchesWebhookEvent(['task.*'], 'run.updated')).toBe(false);
  });

  it('does not treat a longer name as a prefix match', () => {
    expect(matchesWebhookEvent(['task'], 'task.changed')).toBe(false);
  });

  it('matches when any of several subscriptions fits', () => {
    expect(matchesWebhookEvent(['notes.changed', 'run.updated'], 'run.updated')).toBe(true);
  });

  it('matches nothing when there are no subscriptions', () => {
    expect(matchesWebhookEvent([], 'task.changed')).toBe(false);
  });
});

describe('isWebhookPattern', () => {
  it('accepts a known event', () => {
    expect(isWebhookPattern('delegation.updated')).toBe(true);
  });

  it('accepts the wildcard', () => {
    expect(isWebhookPattern('*')).toBe(true);
  });

  it('accepts a family prefix', () => {
    expect(isWebhookPattern('run.*')).toBe(true);
  });

  it('rejects an unknown family', () => {
    expect(isWebhookPattern('invoices.*')).toBe(false);
  });

  it('rejects an unknown event', () => {
    expect(isWebhookPattern('task.exploded')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isWebhookPattern('')).toBe(false);
  });
});

describe('catálogo de eventos', () => {
  it('exposes each event once', () => {
    expect(new Set(WEBHOOK_EVENT_NAMES).size).toBe(WEBHOOK_EVENT_NAMES.length);
  });

  it('knows every name it lists', () => {
    for (const name of WEBHOOK_EVENT_NAMES) expect(isWebhookEvent(name)).toBe(true);
  });

  it('leaves the noisy events out of the "select everything" set', () => {
    expect(QUIET_WEBHOOK_EVENTS).not.toContain('run.log');
    expect(QUIET_WEBHOOK_EVENTS).not.toContain('activity');
    expect(QUIET_WEBHOOK_EVENTS).toContain('task.changed');
    expect(QUIET_WEBHOOK_EVENTS.length).toBeLessThan(WEBHOOK_EVENT_NAMES.length);
  });

  it('falls back to the raw name for anything unknown', () => {
    expect(webhookEventLabel('run.updated')).toBe('Runs');
    expect(webhookEventLabel('inventado')).toBe('inventado');
  });
});
