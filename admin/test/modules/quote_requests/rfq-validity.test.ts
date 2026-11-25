import { describe, expect, it } from 'vitest';
import {
  MS_PER_DAY,
  deadlineForDays,
  isValidityDaysInvalid,
  parseValidityDays,
  rfqValidity,
  unsharedValidityDaysPayload,
} from '../../../../packages/modules/quote_requests/src/admin/validity';

/**
 * The three answers `expiresAt` can give, and the arithmetic behind the
 * deadline preview.
 *
 * "No deadline set" and "the deadline has passed" are opposite answers about
 * the same nullable field — one refuses the customer nothing and the other
 * refuses them `410 RFQ_EXPIRED` / `410 QUOTE_VALIDITY_ENDED` — so the whole
 * point of this classifier is that they never collapse into each other.
 */
describe('rfqValidity', () => {
  const NOW = new Date('2026-08-29T12:00:00.000Z');

  it('reads an absent deadline as "none", not as lapsed', () => {
    expect(rfqValidity(null, NOW)).toEqual({ kind: 'none' });
    expect(rfqValidity(undefined, NOW)).toEqual({ kind: 'none' });
    expect(rfqValidity('', NOW)).toEqual({ kind: 'none' });
  });

  it('reads a future deadline as active', () => {
    const at = '2026-09-05T12:00:00.000Z';
    expect(rfqValidity(at, NOW)).toEqual({ kind: 'active', expiresAt: at });
  });

  it('reads a past deadline as lapsed', () => {
    const at = '2026-08-01T12:00:00.000Z';
    expect(rfqValidity(at, NOW)).toEqual({ kind: 'lapsed', expiresAt: at });
  });

  it('reads the deadline instant itself as lapsed', () => {
    expect(rfqValidity(NOW.toISOString(), NOW).kind).toBe('lapsed');
  });

  it('does not claim a customer is refused on a date it cannot read', () => {
    expect(rfqValidity('not-a-date', NOW).kind).toBe('active');
  });
});

describe('deadlineForDays', () => {
  const NOW = new Date('2026-08-29T12:00:00.000Z');

  it('computes the deadline the server would store', () => {
    // `RfqAdminService.modify`: new Date(Date.now() + expiresInDays * 86_400_000).
    expect(deadlineForDays('14', NOW)?.toISOString()).toBe('2026-09-12T12:00:00.000Z');
    expect(deadlineForDays('14', NOW)?.getTime()).toBe(NOW.getTime() + 14 * MS_PER_DAY);
  });

  it('accepts a number typed with surrounding whitespace', () => {
    expect(deadlineForDays('  14 ', NOW)?.toISOString()).toBe('2026-09-12T12:00:00.000Z');
  });

  // `specs/192-quote-request-draft-share/` FR-032 (owner decision of 2026-11-24):
  // 0 days is no deadline on every write — the server's `normaliseShareValidityDays`.
  it('has no deadline for zero days — 0 never ends validity now', () => {
    expect(deadlineForDays('0', NOW)).toBeNull();
    expect(isValidityDaysInvalid('0')).toBe(false);
    expect(parseValidityDays('0')).toEqual({ kind: 'days', days: 0 });
  });

  it('has no answer for a blank field — that is "leave the deadline alone"', () => {
    expect(deadlineForDays('', NOW)).toBeNull();
    expect(deadlineForDays('   ', NOW)).toBeNull();
    expect(isValidityDaysInvalid('')).toBe(false);
    expect(parseValidityDays('  ')).toEqual({ kind: 'blank' });
  });

  it('refuses what the contract refuses', () => {
    // quoteValidityDaysSchema: a whole number from 0 to QUOTE_VALIDITY_DAYS_MAX (3650).
    for (const raw of ['-1', '2.5', 'abc', '1e', 'Infinity', '3651']) {
      expect(deadlineForDays(raw, NOW)).toBeNull();
      expect(isValidityDaysInvalid(raw)).toBe(true);
    }
  });

  it('accepts the largest number of days the contract accepts', () => {
    expect(isValidityDaysInvalid('3650')).toBe(false);
    expect(deadlineForDays('3650', NOW)?.getTime()).toBe(NOW.getTime() + 3650 * MS_PER_DAY);
  });
});

describe('unsharedValidityDaysPayload (specs/192-quote-request-draft-share/)', () => {
  it('sends nothing while the field holds what it opened with', () => {
    expect(unsharedValidityDaysPayload('30', '30')).toBeUndefined();
    expect(unsharedValidityDaysPayload(' 30 ', '30')).toBeUndefined();
    expect(unsharedValidityDaysPayload('', '')).toBeUndefined();
  });

  it('sends null once a field that held days is emptied — no deadline', () => {
    expect(unsharedValidityDaysPayload('', '30')).toBeNull();
  });

  it('sends the typed number, zero included', () => {
    expect(unsharedValidityDaysPayload('14', '30')).toBe(14);
    expect(unsharedValidityDaysPayload('14', '')).toBe(14);
    expect(unsharedValidityDaysPayload('0', '30')).toBe(0);
  });
});
