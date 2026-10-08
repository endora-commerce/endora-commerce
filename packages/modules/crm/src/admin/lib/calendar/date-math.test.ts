import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CALENDAR_EVENTS_MAX_RANGE_DAYS,
  CalendarEventsQuerySchema,
} from '@endora-commerce/contracts';
import {
  AGENDA_DAYS,
  CALENDAR_VIEWS,
  addDays,
  dateTimeValueOf,
  dayKeyOf,
  daysBetween,
  entriesByDay,
  entriesInRange,
  entryDayKey,
  isDayKey,
  localDate,
  minuteOfDay,
  monthMatrix,
  rangeCovers,
  rangeTitle,
  requestRange,
  shiftDate,
  timeValueOf,
  visibleRange,
  weekDays,
  weekStart,
  type CalendarEntry,
} from './date-math.js';

/**
 * The calendar's date arithmetic (`specs/143-crm-sales-opportunities/`, User
 * Story 22 — task T360; FR-146, FR-147, FR-149).
 *
 * Everything here is "the browser's local time", so the zone is part of each
 * case: Europe/Warsaw by default — its clocks change on the last Sundays of
 * March and October — and a far zone where a case is about a reader elsewhere.
 * Node re-reads `TZ` when it is assigned, which is what lets one file hold both.
 */

const ORIGINAL_TZ = process.env['TZ'];
const zone = (name: string): void => {
  process.env['TZ'] = name;
};

beforeEach(() => zone('Europe/Warsaw'));
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

let sequence = 0;
function entry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  sequence += 1;
  return {
    id: `e${String(sequence).padStart(4, '0')}`,
    name: 'Call back',
    allDay: false,
    startsAt: '2026-10-08T08:00:00.000Z',
    endsAt: '2026-10-08T08:30:00.000Z',
    allDayDate: null,
    href: '/crm/opportunities/x?tab=events',
    context: null,
    hasReminder: false,
    ...overrides,
  };
}

describe('day keys', () => {
  it('reads a zone that is really the one the case names — or every case below proves nothing', () => {
    expect(new Date('2026-07-01T12:00:00Z').getHours()).toBe(14);
    zone('America/Los_Angeles');
    expect(new Date('2026-07-01T12:00:00Z').getHours()).toBe(5);
  });

  it('names the local day of an instant, not the UTC one', () => {
    // 23:30 UTC on the 7th is 01:30 on the 8th in Warsaw (summer time, UTC+2).
    expect(dayKeyOf(new Date('2026-10-07T23:30:00Z'))).toBe('2026-10-08');
    expect(dayKeyOf(new Date('2026-01-01T00:30:00+01:00'))).toBe('2026-01-01');
  });

  it('accepts a day that exists and refuses one that does not', () => {
    expect(isDayKey('2026-10-08')).toBe(true);
    expect(isDayKey('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-29', '2026-13-01', '2026-10-32', '2026-1-1', '08.10.2026', '', null, undefined]) {
      expect(isDayKey(bad), String(bad)).toBe(false);
    }
  });

  it('steps by the calendar across a month, a year and a leap day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('steps by the calendar across the 23-hour and the 25-hour day', () => {
    // 2026: summer time starts 29 March, ends 25 October.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-10-26', -1)).toBe('2026-10-25');
    // Seven steps of one day and one step of seven agree over both changes.
    expect(addDays('2026-03-23', 7)).toBe('2026-03-30');
    expect(addDays('2026-10-19', 7)).toBe('2026-10-26');
    expect(daysBetween('2026-03-23', '2026-03-30')).toBe(7);
    expect(daysBetween('2026-10-26', '2026-10-19')).toBe(-7);
  });

  it('puts both sides of a clock change on the right day', () => {
    // 29 March 2026: 02:00 does not exist; 00:30 UTC is 01:30, 01:30 UTC is 03:30.
    expect(dayKeyOf(new Date('2026-03-28T22:59:00Z'))).toBe('2026-03-28');
    expect(dayKeyOf(new Date('2026-03-28T23:00:00Z'))).toBe('2026-03-29');
    expect(dayKeyOf(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29');
    expect(dayKeyOf(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
    // 25 October 2026: 02:00 – 03:00 happens twice; the day is 25 hours long.
    expect(dayKeyOf(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25');
    expect(dayKeyOf(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25');
    expect(dayKeyOf(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26');
    expect(localDate('2026-10-26').getTime() - localDate('2026-10-25').getTime()).toBe(25 * 3_600_000);
    expect(localDate('2026-03-30').getTime() - localDate('2026-03-29').getTime()).toBe(23 * 3_600_000);
  });

  it('reads the wall clock of an instant', () => {
    const afterTheGap = new Date('2026-03-29T01:30:00Z');
    expect(minuteOfDay(afterTheGap)).toBe(3 * 60 + 30);
    expect(timeValueOf(afterTheGap)).toBe('03:30');
    expect(dateTimeValueOf(afterTheGap)).toBe('2026-03-29T03:30');
    expect(localDate('2026-10-08', 9, 5).toISOString()).toBe('2026-10-08T07:05:00.000Z');
  });
});

describe('weeks', () => {
  it('starts on Monday whatever day is asked', () => {
    expect(weekStart('2026-10-05')).toBe('2026-10-05'); // a Monday
    expect(weekStart('2026-10-08')).toBe('2026-10-05'); // a Thursday
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // a Sunday
    expect(weekStart('2026-10-12')).toBe('2026-10-12');
  });

  it('holds seven days across a month boundary and across each clock change', () => {
    expect(weekDays('2026-10-01')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    expect(weekDays('2026-03-29')).toEqual([
      '2026-03-23', '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27', '2026-03-28', '2026-03-29',
    ]);
    expect(weekDays('2026-10-25').at(-1)).toBe('2026-10-25');
    expect(weekDays('2026-10-26')[0]).toBe('2026-10-26');
    expect(weekDays('2026-12-31')).toEqual([
      '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
    ]);
  });
});

describe('the month grid', () => {
  const shape = (matrix: string[][]): void => {
    expect(matrix).toHaveLength(6);
    for (const week of matrix) {
      expect(week).toHaveLength(7);
      expect(localDate(week[0] as string, 12).getDay()).toBe(1);
    }
    const flat = matrix.flat();
    expect(new Set(flat).size).toBe(42);
    for (let index = 1; index < flat.length; index += 1) {
      expect(daysBetween(flat[index - 1] as string, flat[index] as string)).toBe(1);
    }
  };

  it('is six rows of seven from Monday for a month that starts on a Monday', () => {
    const matrix = monthMatrix('2026-06-15'); // 1 June 2026 is a Monday
    shape(matrix);
    expect(matrix[0]?.[0]).toBe('2026-06-01');
    expect(matrix[5]?.[6]).toBe('2026-07-12');
  });

  it('opens with six days of the month before for a month that starts on a Sunday', () => {
    const matrix = monthMatrix('2026-11-30'); // 1 November 2026 is a Sunday
    shape(matrix);
    expect(matrix[0]).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
    expect(matrix[5]?.[6]).toBe('2026-12-06');
  });

  it('holds 29 February of a leap year', () => {
    const matrix = monthMatrix('2028-02-10'); // 1 February 2028 is a Tuesday
    shape(matrix);
    expect(matrix[0]?.[0]).toBe('2028-01-31');
    expect(matrix.flat()).toContain('2028-02-29');
    expect(matrix.flat()).not.toContain('2028-02-30');
  });

  it('is still 42 consecutive days in the months a clock changes', () => {
    shape(monthMatrix('2026-03-01'));
    shape(monthMatrix('2026-10-01'));
    expect(monthMatrix('2026-10-08')[0]?.[0]).toBe('2026-09-28');
    expect(monthMatrix('2026-10-08')[5]?.[6]).toBe('2026-11-08');
  });
});

describe('the days a view draws', () => {
  it('is the 42 of the grid, the 7 of the week, the one day, the 30 of the agenda', () => {
    expect(visibleRange('month', '2026-10-08')).toEqual({ from: '2026-09-28', to: '2026-11-09' });
    expect(visibleRange('week', '2026-10-08')).toEqual({ from: '2026-10-05', to: '2026-10-12' });
    expect(visibleRange('day', '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-10-09' });
    expect(visibleRange('agenda', '2026-10-08')).toEqual({ from: '2026-10-08', to: '2026-11-07' });
    expect(daysBetween('2026-10-08', visibleRange('agenda', '2026-10-08').to)).toBe(AGENDA_DAYS);
  });

  it('knows a week inside a loaded month, and a week that reaches outside it', () => {
    const month = visibleRange('month', '2026-10-08');
    expect(rangeCovers(month, visibleRange('week', '2026-10-08'))).toBe(true);
    expect(rangeCovers(month, visibleRange('day', '2026-11-08'))).toBe(true);
    expect(rangeCovers(month, visibleRange('week', '2026-11-09'))).toBe(false);
    expect(rangeCovers(month, visibleRange('agenda', '2026-10-20'))).toBe(false);
  });
});

describe('the range asked of the server', () => {
  it('is one local day wider on each side', () => {
    const { from, to } = requestRange(visibleRange('week', '2026-10-08'));
    expect(from.toISOString()).toBe('2026-10-03T22:00:00.000Z'); // 4 October 00:00 +02:00
    expect(to.toISOString()).toBe('2026-10-12T22:00:00.000Z'); // 13 October 00:00 +02:00
  });

  it('is a query the contract accepts — never over 45 days — for every view, in every month of three years', () => {
    for (const zoneName of ['Europe/Warsaw', 'Pacific/Auckland', 'America/Los_Angeles', 'UTC']) {
      zone(zoneName);
      for (let month = 0; month < 36; month += 1) {
        const date = dayKeyOf(new Date(2026, month, 15, 12));
        for (const view of CALENDAR_VIEWS) {
          const { from, to } = requestRange(visibleRange(view, date));
          const days = (to.getTime() - from.getTime()) / 86_400_000;
          expect(days, `${zoneName} ${view} ${date}`).toBeLessThanOrEqual(CALENDAR_EVENTS_MAX_RANGE_DAYS);
          const parsed = CalendarEventsQuerySchema.safeParse({
            from: from.toISOString(),
            to: to.toISOString(),
          });
          expect(parsed.success, `${zoneName} ${view} ${date}`).toBe(true);
        }
      }
    }
  });

  it('is 44 days and an hour for the month grid that holds the 25-hour day', () => {
    const { from, to } = requestRange(visibleRange('month', '2026-10-08'));
    expect(to.getTime() - from.getTime()).toBe(44 * 86_400_000 + 3_600_000);
  });
});

describe('previous and next', () => {
  it('moves a month and keeps the day where the month has it', () => {
    expect(shiftDate('month', '2026-10-08', 1)).toBe('2026-11-08');
    expect(shiftDate('month', '2026-10-08', -1)).toBe('2026-09-08');
    expect(shiftDate('month', '2026-10-31', 1)).toBe('2026-11-30');
    expect(shiftDate('month', '2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftDate('month', '2028-03-31', -1)).toBe('2028-02-29');
    expect(shiftDate('month', '2026-12-15', 1)).toBe('2027-01-15');
    expect(shiftDate('month', '2027-01-15', -1)).toBe('2026-12-15');
  });

  it('moves a week, a day, or the agenda’s thirty days', () => {
    expect(shiftDate('week', '2026-10-22', 1)).toBe('2026-10-29'); // over the 25-hour day
    expect(shiftDate('week', '2026-03-30', -1)).toBe('2026-03-23'); // over the 23-hour day
    expect(shiftDate('day', '2026-10-25', 1)).toBe('2026-10-26');
    expect(shiftDate('day', '2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('agenda', '2026-10-08', 1)).toBe('2026-11-07');
    expect(shiftDate('agenda', '2026-11-07', -1)).toBe('2026-10-08');
  });
});

describe('the range title', () => {
  it('names the month, the week, the day and the agenda’s span in the language asked', () => {
    expect(rangeTitle('month', '2026-10-08', 'en')).toBe('October 2026');
    expect(rangeTitle('month', '2026-10-08', 'pl')).toBe('październik 2026');
    expect(rangeTitle('week', '2026-10-08', 'en')).toMatch(/^October 5\s–\s11, 2026$/);
    expect(rangeTitle('week', '2026-10-08', 'pl')).toMatch(/^5\s?–\s?11 października 2026$/);
    expect(rangeTitle('day', '2026-10-08', 'en')).toBe('Thursday, October 8, 2026');
    expect(rangeTitle('agenda', '2026-10-08', 'en')).toMatch(/^October 8\s–\sNovember 6, 2026$/);
  });

  it('names both months and both years of a week that straddles them', () => {
    expect(rangeTitle('week', '2026-12-31', 'en')).toMatch(/December 28, 2026\s–\sJanuary 3, 2027/);
  });
});

describe('the day an entry is drawn on', () => {
  it('places a timed entry on the local day it starts on', () => {
    expect(entryDayKey(entry({ startsAt: '2026-10-08T21:30:00.000Z', endsAt: '2026-10-08T22:30:00.000Z' }))).toBe(
      '2026-10-08', // 23:30 – 00:30 in Warsaw: the day it starts on
    );
    expect(entryDayKey(entry({ startsAt: '2026-10-08T22:30:00.000Z', endsAt: '2026-10-08T23:00:00.000Z' }))).toBe(
      '2026-10-09',
    );
  });

  it('places an all-day entry by its date, whatever zone the reader is in', () => {
    // 8 October, all day, in Warsaw: its instants are 7 October 22:00Z – 8 October 22:00Z.
    const allDay = entry({
      allDay: true,
      allDayDate: '2026-10-08',
      startsAt: '2026-10-07T22:00:00.000Z',
      endsAt: '2026-10-08T22:00:00.000Z',
    });
    for (const zoneName of ['Europe/Warsaw', 'America/Los_Angeles', 'Pacific/Auckland', 'Pacific/Kiritimati', 'UTC']) {
      zone(zoneName);
      expect(entryDayKey(allDay), zoneName).toBe('2026-10-08');
    }
    // The instants alone would have said the 7th here.
    zone('America/Los_Angeles');
    expect(dayKeyOf(new Date(allDay.startsAt))).toBe('2026-10-07');
  });

  it('places a timed entry on another day for a reader in another zone', () => {
    const late = entry({ startsAt: '2026-10-08T21:30:00.000Z', endsAt: '2026-10-08T22:00:00.000Z' });
    expect(entryDayKey(late)).toBe('2026-10-08');
    zone('Pacific/Auckland');
    expect(entryDayKey(late)).toBe('2026-10-09');
  });

  it('buckets entries by day: all-day first, then by start, the same order every time', () => {
    const morning = entry({ name: 'Morning', startsAt: '2026-10-08T06:00:00.000Z', endsAt: '2026-10-08T07:00:00.000Z' });
    const noon = entry({ name: 'Noon', startsAt: '2026-10-08T10:00:00.000Z', endsAt: '2026-10-08T11:00:00.000Z' });
    const twin = entry({ name: 'Also noon', startsAt: noon.startsAt, endsAt: noon.endsAt });
    const allDay = entry({ name: 'Fair', allDay: true, allDayDate: '2026-10-08', startsAt: '2026-10-07T22:00:00.000Z', endsAt: '2026-10-08T22:00:00.000Z' });
    const nextDay = entry({ name: 'Next', startsAt: '2026-10-09T06:00:00.000Z', endsAt: '2026-10-09T07:00:00.000Z' });
    const byDay = entriesByDay([noon, nextDay, twin, allDay, morning]);
    expect([...byDay.keys()].sort()).toEqual(['2026-10-08', '2026-10-09']);
    expect(byDay.get('2026-10-08')?.map((item) => item.name)).toEqual(['Fair', 'Morning', 'Also noon', 'Noon']);
    expect(entriesByDay([morning, allDay, twin, noon]).get('2026-10-08')?.map((item) => item.name)).toEqual([
      'Fair', 'Morning', 'Also noon', 'Noon',
    ]);
    expect(entriesInRange(byDay, { from: '2026-10-09', to: '2026-10-10' })).toEqual([nextDay]);
    expect(entriesInRange(byDay, { from: '2026-10-01', to: '2026-10-08' })).toEqual([]);
    expect(entriesInRange(byDay, { from: '2026-10-05', to: '2026-10-12' })).toHaveLength(5);
  });

  it('keeps the two 02:30s of the day a clock goes back on that one day, in order', () => {
    const first = entry({ name: 'First 02:30', startsAt: '2026-10-25T00:30:00.000Z', endsAt: '2026-10-25T00:45:00.000Z' });
    const second = entry({ name: 'Second 02:30', startsAt: '2026-10-25T01:30:00.000Z', endsAt: '2026-10-25T01:45:00.000Z' });
    expect(timeValueOf(new Date(first.startsAt))).toBe('02:30');
    expect(timeValueOf(new Date(second.startsAt))).toBe('02:30');
    expect(entriesByDay([second, first]).get('2026-10-25')?.map((item) => item.name)).toEqual([
      'First 02:30', 'Second 02:30',
    ]);
  });
});
