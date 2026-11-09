import { describe, expect, it } from 'vitest';
import {
  STATUTORY_WITHDRAWAL_DAYS,
  WITHDRAWAL_GRACE_DAYS,
  isWithdrawalAvailableAt,
  isWithinStatutoryPeriod,
  periodEndAfter,
  withdrawalPeriod,
  withdrawalPeriodAnchor,
} from './withdrawal-period.js';

/**
 * Issue #905 (PR 1, design D3.4 and D3.5) — the consumer's withdrawal period
 * counted in calendar days in `returns.time_zone`, from the moment the order
 * entered its completing status, with a last day on a Saturday or Sunday moved
 * to the Monday, and a 7-day grace before the withdrawal function closes.
 */
const WARSAW = 'Europe/Warsaw';
const at = (iso: string) => new Date(iso);
const later = (date: Date, ms = 1) => new Date(date.getTime() + ms);

describe('the constants', () => {
  it('are 14 statutory days (Directive 2011/83 art. 9) and a 7-day grace (owner ruling on #905)', () => {
    expect(STATUTORY_WITHDRAWAL_DAYS).toBe(14);
    expect(WITHDRAWAL_GRACE_DAYS).toBe(7);
  });
});

describe('withdrawalPeriodAnchor', () => {
  it('is the moment the order entered its completing status', () => {
    const completed = at('2026-10-20T10:00:00Z');
    expect(withdrawalPeriodAnchor({ completingStatusEnteredAt: completed })).toEqual(completed);
  });

  it('is null for an order that has not been completed', () => {
    expect(withdrawalPeriodAnchor({ completingStatusEnteredAt: null })).toBeNull();
  });
});

describe('periodEndAfter — calendar days in the returns time zone', () => {
  it('ends at the end of the 14th calendar day after the anchor’s day, across the October DST switch', () => {
    // Tuesday 20 Oct (12:00 CEST); 14 days later is Tuesday 3 Nov, after the
    // switch to CET on Sunday 25 Oct: the day ends at 23:00 UTC.
    expect(periodEndAfter(at('2026-10-20T10:00:00Z'), 14, WARSAW)).toEqual(at('2026-11-03T22:59:59.999Z'));
  });

  it('counts from the anchor’s calendar day in the zone, not in UTC', () => {
    // 22:30 UTC on 1 June is 00:30 on 2 June in Warsaw.
    expect(periodEndAfter(at('2026-06-01T22:30:00Z'), 14, WARSAW)).toEqual(at('2026-06-16T21:59:59.999Z'));
    expect(periodEndAfter(at('2026-06-01T22:30:00Z'), 14, 'UTC')).toEqual(at('2026-06-15T23:59:59.999Z'));
  });

  it('moves a last day on a Saturday to the following Monday', () => {
    // Saturday 10 Oct + 14 = Saturday 24 Oct → Monday 26 Oct, in CET.
    expect(periodEndAfter(at('2026-10-10T08:00:00Z'), 14, WARSAW)).toEqual(at('2026-10-26T22:59:59.999Z'));
  });

  it('moves a last day on a Sunday to the following Monday', () => {
    // Sunday 25 Oct + 14 = Sunday 8 Nov → Monday 9 Nov.
    expect(periodEndAfter(at('2026-10-25T09:00:00Z'), 14, WARSAW)).toEqual(at('2026-11-09T22:59:59.999Z'));
  });

  it('refuses a zone the runtime does not know', () => {
    expect(() => periodEndAfter(at('2026-10-20T10:00:00Z'), 14, 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('withdrawalPeriod', () => {
  const anchor = at('2026-10-20T10:00:00Z');

  it('has not started for an order that has not been completed', () => {
    const period = withdrawalPeriod(null, { timeZone: WARSAW, freeReturnDays: 14 });
    expect(period).toEqual({ startsAt: null, endsAt: null, freeWindowEndsAt: null, availableUntil: null });
    expect(isWithinStatutoryPeriod(period, at('2030-01-01T00:00:00Z'))).toBe(true);
    expect(isWithdrawalAvailableAt(period, at('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('keeps the function available for 7 days after the statutory end', () => {
    const period = withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays: 14 });
    expect(period.startsAt).toEqual(anchor);
    expect(period.endsAt).toEqual(at('2026-11-03T22:59:59.999Z'));
    expect(period.freeWindowEndsAt).toEqual(at('2026-11-03T22:59:59.999Z'));
    expect(period.availableUntil).toEqual(at('2026-11-10T22:59:59.999Z'));
  });

  it('counts the grace from the channel’s longer free-return window', () => {
    // 20 Oct + 30 = Thursday 19 Nov; + 7 = Thursday 26 Nov.
    const period = withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays: 30 });
    expect(period.endsAt).toEqual(at('2026-11-03T22:59:59.999Z'));
    expect(period.freeWindowEndsAt).toEqual(at('2026-11-19T22:59:59.999Z'));
    expect(period.availableUntil).toEqual(at('2026-11-26T22:59:59.999Z'));
  });

  it('never lets a shorter or absent free-return window shorten the statutory period', () => {
    for (const freeReturnDays of [0, 7]) {
      const period = withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays });
      expect(period.endsAt).toEqual(at('2026-11-03T22:59:59.999Z'));
      expect(period.availableUntil).toEqual(at('2026-11-10T22:59:59.999Z'));
    }
    expect(withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays: 0 }).freeWindowEndsAt).toBeNull();
  });

  it('is within the statutory period up to and including its last instant', () => {
    const period = withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays: 14 });
    expect(isWithinStatutoryPeriod(period, anchor)).toBe(true);
    expect(isWithinStatutoryPeriod(period, at('2026-11-03T22:59:59.999Z'))).toBe(true);
    expect(isWithinStatutoryPeriod(period, at('2026-11-03T23:00:00.000Z'))).toBe(false);
  });

  it('treats the grace boundary as inclusive', () => {
    const period = withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays: 14 });
    expect(isWithdrawalAvailableAt(period, period.availableUntil!)).toBe(true);
    expect(isWithdrawalAvailableAt(period, later(period.availableUntil!))).toBe(false);
  });

  it('accepts a statement inside the grace, outside the statutory period', () => {
    const period = withdrawalPeriod(anchor, { timeZone: WARSAW, freeReturnDays: 14 });
    const inGrace = at('2026-11-05T09:00:00Z');
    expect(isWithdrawalAvailableAt(period, inGrace)).toBe(true);
    expect(isWithinStatutoryPeriod(period, inGrace)).toBe(false);
  });
});
