import { describe, expect, it } from 'vitest';

import {
  approvalDecisionFor,
  approvalSecondsLeft,
  holdsLease,
  isApprovalExpired,
  isLeaseLive,
  leaseSecondsLeft,
} from '@/lib/agent-flow/lease';

const NOW = new Date('2026-10-18T12:00:00.000Z');
const IN_TEN_MIN = new Date('2026-10-18T12:10:00.000Z');
const TEN_MIN_AGO = new Date('2026-10-18T11:50:00.000Z');

describe('leases', () => {
  it('counts a lease live only while somebody holds it and the clock has not run out', () => {
    expect(isLeaseLive({ claimedByAgentId: 'a', leaseExpiresAt: IN_TEN_MIN }, NOW)).toBe(true);
    expect(isLeaseLive({ claimedByAgentId: 'a', leaseExpiresAt: TEN_MIN_AGO }, NOW)).toBe(false);
    expect(isLeaseLive({ claimedByAgentId: null, leaseExpiresAt: IN_TEN_MIN }, NOW)).toBe(false);
  });

  it('treats a holder without a deadline as expired, not as held forever', () => {
    expect(isLeaseLive({ claimedByAgentId: 'a', leaseExpiresAt: null }, NOW)).toBe(false);
    expect(leaseSecondsLeft({ claimedByAgentId: 'a', leaseExpiresAt: null }, NOW)).toBe(0);
  });

  it('accepts an ISO string the same as a Date, which is what a DTO carries', () => {
    expect(
      isLeaseLive({ claimedByAgentId: 'a', leaseExpiresAt: IN_TEN_MIN.toISOString() }, NOW),
    ).toBe(true);
    expect(isLeaseLive({ claimedByAgentId: 'a', leaseExpiresAt: 'basura' }, NOW)).toBe(false);
  });

  it('only lets the agent that holds the lease act on it', () => {
    const task = { claimedByAgentId: 'a', leaseExpiresAt: IN_TEN_MIN };
    expect(holdsLease(task, 'a', NOW)).toBe(true);
    expect(holdsLease(task, 'b', NOW)).toBe(false);
    // Once it lapses, not even the holder is holding it any more.
    expect(holdsLease({ claimedByAgentId: 'a', leaseExpiresAt: TEN_MIN_AGO }, 'a', NOW)).toBe(false);
  });

  it('reports the remaining seconds, floored at zero', () => {
    expect(leaseSecondsLeft({ claimedByAgentId: 'a', leaseExpiresAt: IN_TEN_MIN }, NOW)).toBe(600);
    expect(leaseSecondsLeft({ claimedByAgentId: 'a', leaseExpiresAt: TEN_MIN_AGO }, NOW)).toBe(0);
    expect(leaseSecondsLeft({ claimedByAgentId: null, leaseExpiresAt: null }, NOW)).toBeNull();
  });
});

describe('approvals', () => {
  it('reads a lapsed approval as a rejection', () => {
    const lapsed = { status: 'pending' as const, expiresAt: TEN_MIN_AGO };
    expect(isApprovalExpired(lapsed, NOW)).toBe(true);
    expect(approvalDecisionFor(lapsed, NOW)).toBe('rejected');
  });

  it('reads an approval with no deadline as a rejection too', () => {
    const broken = { status: 'pending' as const, expiresAt: null };
    expect(isApprovalExpired(broken, NOW)).toBe(true);
    expect(approvalDecisionFor(broken, NOW)).toBe('rejected');
  });

  it('keeps a live pending approval pending', () => {
    const live = { status: 'pending' as const, expiresAt: IN_TEN_MIN };
    expect(isApprovalExpired(live, NOW)).toBe(false);
    expect(approvalDecisionFor(live, NOW)).toBe('pending');
    expect(approvalSecondsLeft(live, NOW)).toBe(600);
  });

  it('maps the decided states, and never re-expires a decided one', () => {
    expect(approvalDecisionFor({ status: 'approved', expiresAt: TEN_MIN_AGO }, NOW)).toBe('approved');
    expect(approvalDecisionFor({ status: 'rejected', expiresAt: IN_TEN_MIN }, NOW)).toBe('rejected');
    expect(approvalDecisionFor({ status: 'expired', expiresAt: TEN_MIN_AGO }, NOW)).toBe('rejected');
    expect(approvalDecisionFor({ status: 'cancelled', expiresAt: IN_TEN_MIN }, NOW)).toBe('cancelled');
    // A decision already taken is not re-read as expired, however old it is.
    expect(isApprovalExpired({ status: 'approved', expiresAt: TEN_MIN_AGO }, NOW)).toBe(false);
  });

  it('stops counting down once decided', () => {
    expect(approvalSecondsLeft({ status: 'approved', expiresAt: IN_TEN_MIN }, NOW)).toBeNull();
  });
});
