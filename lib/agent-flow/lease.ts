/**
 * Deadlines: task leases and approval expiry.
 *
 * Pure arithmetic over dates, free of the database, so the one rule that
 * matters can be tested without a Postgres: **everything fails closed**. A
 * lease with no expiry is expired, an approval with no expiry is expired, and
 * an expired approval is a rejection. The alternative — treating a missing
 * deadline as "no deadline" — is how an agent ends up holding a task forever
 * because one UPDATE went missing.
 */
import type { ApprovalStatusValue } from '@/lib/constants';

/** Defaults; `lib/env.ts` lets each one be overridden. */
export const DEFAULT_LEASE_TTL_SECONDS = 900; // 15 min
export const DEFAULT_HEARTBEAT_SECONDS = 300; // 5 min
export const DEFAULT_APPROVAL_TTL_SECONDS = 86_400; // 24 h

export type LeaseState = {
  claimedByAgentId: string | null;
  leaseExpiresAt: Date | string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A lease is live only if somebody holds it *and* the clock has not run out.
 * No holder means no lease; no expiry means a broken row, and a broken row is
 * not a reason to keep a task hostage.
 */
export function isLeaseLive(task: LeaseState, now: Date = new Date()): boolean {
  if (!task.claimedByAgentId) return false;
  const expires = asDate(task.leaseExpiresAt);
  if (!expires) return false;
  return expires.getTime() > now.getTime();
}

/** Seconds left on the lease, floored at 0. Null when nothing holds it. */
export function leaseSecondsLeft(task: LeaseState, now: Date = new Date()): number | null {
  if (!task.claimedByAgentId) return null;
  const expires = asDate(task.leaseExpiresAt);
  if (!expires) return 0;
  return Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));
}

/** Whether the agent holding the lease is the one asking. */
export function holdsLease(
  task: LeaseState,
  agentId: string,
  now: Date = new Date(),
): boolean {
  return isLeaseLive(task, now) && task.claimedByAgentId === agentId;
}

export type ApprovalDeadline = {
  status: ApprovalStatusValue;
  expiresAt: Date | string | null;
};

export function isApprovalExpired(
  approval: ApprovalDeadline,
  now: Date = new Date(),
): boolean {
  if (approval.status !== 'pending') return false;
  const expires = asDate(approval.expiresAt);
  // No deadline on a pending row is a bug upstream; it is read as expired
  // rather than as permission to wait forever.
  if (!expires) return true;
  return expires.getTime() <= now.getTime();
}

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'cancelled';

/**
 * What the agent should do about an approval.
 *
 * The whole point: `expired` comes back as `rejected`. An agent never has to
 * know that a deadline existed, only that the answer was no.
 */
export function approvalDecisionFor(
  approval: ApprovalDeadline,
  now: Date = new Date(),
): ApprovalDecision {
  if (isApprovalExpired(approval, now)) return 'rejected';

  switch (approval.status) {
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'expired':
      return 'rejected';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function approvalSecondsLeft(
  approval: ApprovalDeadline,
  now: Date = new Date(),
): number | null {
  if (approval.status !== 'pending') return null;
  const expires = asDate(approval.expiresAt);
  if (!expires) return 0;
  return Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));
}
