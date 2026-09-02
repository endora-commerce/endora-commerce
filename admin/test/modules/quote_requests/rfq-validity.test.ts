import { describe, expect, it } from 'vitest';
import {
  MS_PER_DAY,
  deadlineForDays,
  isValidityDaysInvalid,
  rfqValidity,
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

  it('treats zero as a real deadline of "now"', () => {
    expect(deadlineForDays('0', NOW)?.toISOString()).toBe(NOW.toISOString());
  });

  it('has no answer for a blank field — that is "leave the deadline alone"', () => {
    expect(deadlineForDays('', NOW)).toBeNull();
    expect(deadlineForDays('   ', NOW)).toBeNull();
    expect(isValidityDaysInvalid('', NOW)).toBe(false);
  });

  it('refuses what the contract refuses', () => {
    // adminPatchQuoteRequestSchema: z.number().int().nonnegative().optional()
    for (const raw of ['-1', '2.5', 'abc', '1e', 'Infinity']) {
      expect(deadlineForDays(raw, NOW)).toBeNull();
      expect(isValidityDaysInvalid(raw, NOW)).toBe(true);
    }
  });
});
