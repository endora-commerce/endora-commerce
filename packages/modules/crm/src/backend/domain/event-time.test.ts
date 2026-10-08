import { describe, expect, it } from 'vitest';
import { allDayDateOf, checkEventTime, eventWhen, isKnownTimeZone } from './event-time.js';

/**
 * The time rules of an Event
 * (`specs/143-crm-sales-opportunities/data-model.md` § *`crm_opportunity_events`*
 * → Rules; FR-131; research N-CAL1).
 *
 * An Event is one calendar day **in the zone it was planned in**: a timed one
 * starts and ends on the same local date, an all-day one is a local date from
 * its first instant to the first instant of the next. The server only ever
 * formats an instant into a zone — it never looks for the instant of a local
 * midnight — so every case here is given as instants.
 */
describe('checkEventTime', () => {
  const at = (iso: string) => new Date(iso);
  const timed = (startsAt: string, endsAt: string, timeZone: string) =>
    checkEventTime({ allDay: false, startsAt: at(startsAt), endsAt: at(endsAt), timeZone });
  const allDay = (startsAt: string, endsAt: string, timeZone: string) =>
    checkEventTime({ allDay: true, startsAt: at(startsAt), endsAt: at(endsAt), timeZone });

  it('accepts a timed Event inside one local day', () => {
    expect(timed('2026-06-10T08:00:00Z', '2026-06-10T09:30:00Z', 'Europe/Warsaw')).toBeNull();
  });

  it('accepts a timed Event that ends exactly at the next local midnight — the end is exclusive', () => {
    // 22:00 – 24:00 in Warsaw (UTC+2 in June).
    expect(timed('2026-06-10T20:00:00Z', '2026-06-10T22:00:00Z', 'Europe/Warsaw')).toBeNull();
  });

  it('refuses one crossing local midnight in its zone, though it is inside one UTC day', () => {
    // 23:00 – 01:00 in Tokyo.
    expect(timed('2026-06-10T14:00:00Z', '2026-06-10T16:00:00Z', 'Asia/Tokyo')).toEqual({
      rule: 'spans_days',
      field: 'endsAt',
    });
  });

  it('accepts one inside a local day, though it crosses UTC midnight', () => {
    // 08:00 – 10:00 in Tokyo, on the 11th.
    expect(timed('2026-06-10T23:00:00Z', '2026-06-11T01:00:00Z', 'Asia/Tokyo')).toBeNull();
  });

  it('refuses an end that is not after the start', () => {
    expect(timed('2026-06-10T09:00:00Z', '2026-06-10T09:00:00Z', 'Europe/Warsaw')).toEqual({
      rule: 'ends_before_start',
      field: 'endsAt',
    });
    expect(timed('2026-06-10T09:00:00Z', '2026-06-10T08:00:00Z', 'Europe/Warsaw')).toEqual({
      rule: 'ends_before_start',
      field: 'endsAt',
    });
  });

  it('refuses a zone the runtime does not know, before it judges the times', () => {
    expect(timed('2026-06-10T09:00:00Z', '2026-06-10T08:00:00Z', 'Mars/Olympus_Mons')).toEqual({
      rule: 'unknown_time_zone',
      field: 'timeZone',
    });
    expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isKnownTimeZone('')).toBe(false);
    expect(isKnownTimeZone('Europe/Warsaw')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
  });

  describe('all day — a local midnight to the next, however long that day is', () => {
    it('an ordinary day is 24 hours: accepted at 24, refused at 23 and at 25', () => {
      // 2026-06-10 in Warsaw (UTC+2).
      expect(allDay('2026-06-09T22:00:00Z', '2026-06-10T22:00:00Z', 'Europe/Warsaw')).toBeNull();
      expect(allDay('2026-06-09T22:00:00Z', '2026-06-10T21:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'endsAt',
      });
      expect(allDay('2026-06-09T22:00:00Z', '2026-06-10T23:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'endsAt',
      });
    });

    it('the day the clocks go forward is 23 hours: accepted at 23, refused at 24', () => {
      // 2026-03-29 in Warsaw: midnight is UTC+1, the next one UTC+2.
      expect(allDay('2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 'Europe/Warsaw')).toBeNull();
      expect(allDay('2026-03-28T23:00:00Z', '2026-03-29T23:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'endsAt',
      });
    });

    it('the day the clocks go back is 25 hours: accepted at 25, refused at 24', () => {
      // 2026-10-25 in Warsaw: midnight is UTC+2, the next one UTC+1.
      expect(allDay('2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 'Europe/Warsaw')).toBeNull();
      expect(allDay('2026-10-24T22:00:00Z', '2026-10-25T22:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'endsAt',
      });
    });

    it('refuses a start that is not a local midnight, naming the start', () => {
      expect(allDay('2026-06-09T22:30:00Z', '2026-06-10T22:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'startsAt',
      });
      // A whole UTC day is not a whole day in Warsaw.
      expect(allDay('2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'startsAt',
      });
    });

    it('refuses two whole days', () => {
      expect(allDay('2026-06-09T22:00:00Z', '2026-06-11T22:00:00Z', 'Europe/Warsaw')).toEqual({
        rule: 'not_whole_day',
        field: 'endsAt',
      });
    });
  });
});

describe('allDayDateOf', () => {
  it('is the local date of the start, east of UTC', () => {
    // Midnight of 2026-06-11 in Auckland (UTC+12) is noon of the 10th in UTC.
    expect(allDayDateOf(new Date('2026-06-10T12:00:00Z'), 'Pacific/Auckland')).toBe('2026-06-11');
  });

  it('is the local date of the start, west of UTC', () => {
    // Midnight of 2026-06-10 in Los Angeles (UTC−7) is 07:00 of the 10th in UTC.
    expect(allDayDateOf(new Date('2026-06-10T07:00:00Z'), 'America/Los_Angeles')).toBe('2026-06-10');
    // One second earlier it is still the 9th there.
    expect(allDayDateOf(new Date('2026-06-10T06:59:59Z'), 'America/Los_Angeles')).toBe('2026-06-09');
  });

  it('writes four digits of year, as the date of the contract does — also before the year 1000', () => {
    // `Intl` writes the year 500 as "500"; `YYYY-MM-DD` is what a reader parses.
    expect(allDayDateOf(new Date('0500-06-01T00:00:00.000Z'), 'UTC')).toBe('0500-06-01');
    expect(allDayDateOf(new Date('0001-01-03T00:00:00.000Z'), 'UTC')).toBe('0001-01-03');
    expect(allDayDateOf(new Date('9999-12-29T12:00:00.000Z'), 'Pacific/Kiritimati')).toBe('9999-12-30');
  });
});

describe('eventWhen', () => {
  const evening = { allDay: false, startsAt: new Date('2026-10-08T16:42:00Z'), timeZone: 'Europe/Warsaw' };

  it('words a timed Event in the language asked for: its date and time in its own zone, and the zone', () => {
    expect(eventWhen(evening, 'pl-PL')).toBe('8 października 2026, 18:42 (Europe/Warsaw)');
    expect(eventWhen(evening, 'en-US')).toBe('October 8, 2026, 6:42 PM (Europe/Warsaw)');
  });

  it('says midnight as the day it starts, never as the end of the day before', () => {
    const midnight = { allDay: false, startsAt: new Date('2026-10-11T22:00:00Z'), timeZone: 'Europe/Warsaw' };
    expect(eventWhen(midnight, 'pl-PL')).toBe('12 października 2026, 00:00 (Europe/Warsaw)');
    expect(eventWhen(midnight, 'en-US')).toBe('October 12, 2026, 12:00 AM (Europe/Warsaw)');
  });

  it('words an all-day Event as its date alone — a date is the same date for every reader', () => {
    const allDay = { allDay: true, startsAt: new Date('2026-06-10T12:00:00Z'), timeZone: 'Pacific/Auckland' };
    expect(eventWhen(allDay, 'pl-PL')).toBe('11 czerwca 2026');
    expect(eventWhen(allDay, 'en-US')).toBe('June 11, 2026');
  });

  it('is one line of plain text, whatever the language', () => {
    for (const language of ['pl-PL', 'en-US'] as const) {
      // `Intl` separates "6:42" from "PM" with a narrow no-break space; a bell param and a subject get a plain one.
      expect(eventWhen(evening, language)).toMatch(/^[\x20-\x7e\u00a1-\u017f]+$/);
    }
  });
});
