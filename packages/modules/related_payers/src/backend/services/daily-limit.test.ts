import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { assertWithinDailyLimit, dailyWindowStart } from './daily-limit.js';

/**
 * `specs/182-related-payers/` T068 (FR-046) — the day a sender's requests and invitations count
 * in starts at local midnight in the store's time zone; at the limit the next one is refused
 * before anything is looked up.
 */
describe('daily limit', () => {
  it('starts the window at local midnight in the store time zone', () => {
    // 2026-11-18T23:30Z is 00:30 on the 19th in Warsaw (UTC+1): the window started at 23:00Z.
    expect(dailyWindowStart(new Date('2026-11-18T23:30:00Z'), 'Europe/Warsaw').toISOString()).toBe('2026-11-18T23:00:00.000Z');
    // 2026-07-01T21:30Z is 23:30 on the 1st in Warsaw (UTC+2): the window started at 2026-06-30T22:00Z.
    expect(dailyWindowStart(new Date('2026-07-01T21:30:00Z'), 'Europe/Warsaw').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(dailyWindowStart(new Date('2026-11-18T10:00:00Z'), 'UTC').toISOString()).toBe('2026-11-18T00:00:00.000Z');
  });

  it('allows below the limit and refuses at it with 429 RELATED_PAYER_REQUEST_LIMIT', () => {
    expect(() => assertWithinDailyLimit(4, 5)).not.toThrow();
    expect(() => assertWithinDailyLimit(5, 5)).toThrow(
      expect.objectContaining({ statusCode: 429, code: ERROR_CODES.RELATED_PAYER_REQUEST_LIMIT }),
    );
  });
});
