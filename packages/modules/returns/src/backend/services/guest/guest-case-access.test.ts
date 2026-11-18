import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRACKING_LINK_VALID_DAYS_AFTER_CLOSING, isTrackingLinkOpen, trackingLinkValidUntil } from './guest-case-access.js';

/**
 * `specs/181-guest-complaints/` T039 (FR-043; research R-1, R-5).
 *
 * 1. **R-1's static rule.** Anonymous traffic runs in the platform's unfiltered system
 *    mode, so the guest and tracking routes must never query a case row themselves:
 *    `GuestCaseAccess` is the one home that turns a guest credential into rows. The
 *    route file imports no entity class and holds no entity manager.
 * 2. **The link's validity**, computed and never stored: a guest case, its version, not
 *    erased, and open — or closed less than 90 days ago.
 */
describe('routes.guest.ts reaches case rows only through GuestCaseAccess (R-1)', () => {
  const source = readFileSync(new URL('../../routes.guest.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);

  it('imports no entity', () => {
    expect(imports.filter((path) => path.includes('/entities/'))).toEqual([]);
    expect(imports).not.toContain('@mikro-orm/core');
    expect(imports).not.toContain('@mikro-orm/postgresql');
  });

  it('names no case entity class and opens no entity manager', () => {
    for (const name of ['ReturnCase', 'ReturnCaseAttachment', 'ReturnCaseComment', 'ReturnCaseItem', 'ReturnGuestVerification']) {
      expect(source).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(source).not.toMatch(/\bemFactory\b|\bEntityManager\b|\.fork\(\)/);
  });

  it('opens a tracking token through GuestCaseAccess', () => {
    expect(source).toMatch(/GuestCaseAccess/);
    expect(source).toMatch(/\.load\(/);
  });
});

describe('the tracking link’s validity (FR-043, R-5)', () => {
  const now = new Date('2026-11-16T12:00:00Z');
  const day = 86_400_000;
  const open = { customerAccountId: null, trackingVersion: 1, personalDataErasedAt: null, closedAt: null };

  it('is 90 days after closing', () => {
    expect(TRACKING_LINK_VALID_DAYS_AFTER_CLOSING).toBe(90);
    expect(trackingLinkValidUntil(open)).toBeNull();
    const closedAt = new Date(now.getTime() - 10 * day);
    expect(trackingLinkValidUntil({ ...open, closedAt })).toEqual(new Date(closedAt.getTime() + 90 * day));
    expect(trackingLinkValidUntil({ ...open, closedAt, personalDataErasedAt: now })).toBeNull();
  });

  it('opens a guest case at its version while open or closed for under 90 days', () => {
    expect(isTrackingLinkOpen(open, 1, now)).toBe(true);
    expect(isTrackingLinkOpen({ ...open, closedAt: new Date(now.getTime() - 89 * day) }, 1, now)).toBe(true);
  });

  it('refuses another version, an expired, an erased and a customer’s case', () => {
    expect(isTrackingLinkOpen(open, 2, now)).toBe(false);
    expect(isTrackingLinkOpen({ ...open, trackingVersion: 2 }, 1, now)).toBe(false);
    expect(isTrackingLinkOpen({ ...open, closedAt: new Date(now.getTime() - 90 * day) }, 1, now)).toBe(false);
    expect(isTrackingLinkOpen({ ...open, personalDataErasedAt: now }, 1, now)).toBe(false);
    expect(isTrackingLinkOpen({ ...open, customerAccountId: 'acc' }, 1, now)).toBe(false);
    expect(isTrackingLinkOpen({ ...open, trackingVersion: null }, 1, now)).toBe(false);
  });
});
