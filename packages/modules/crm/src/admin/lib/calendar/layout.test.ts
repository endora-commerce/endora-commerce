import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CalendarEntry } from './date-math.js';
import {
  HOUR_HEIGHT,
  MIN_ENTRY_HEIGHT,
  layoutDay,
  monthCell,
  offsetOfMinute,
  timedSpan,
} from './layout.js';

/**
 * The calendar's geometry (`specs/143-crm-sales-opportunities/`, User Story 22
 * — task T361; FR-147): a day's timed entries placed and packed, and what a
 * month cell shows.
 */

const ORIGINAL_TZ = process.env['TZ'];
beforeEach(() => {
  process.env['TZ'] = 'Europe/Warsaw';
});
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env['TZ'];
  else process.env['TZ'] = ORIGINAL_TZ;
});

/** A timed entry on 8 October 2026 from and to Warsaw wall-clock times (UTC+2). */
function timed(name: string, from: string, to: string, day = '2026-10-08'): CalendarEntry {
  const instant = (time: string, onDay: string): string => new Date(`${onDay}T${time}:00+02:00`).toISOString();
  const endDay = to <= from ? '2026-10-09' : day;
  return {
    id: name,
    name,
    allDay: false,
    startsAt: instant(from, day),
    endsAt: instant(to, endDay),
    allDayDate: null,
    href: `/crm/opportunities/x?tab=events&event=${name}`,
    context: null,
    hasReminder: false,
  };
}

function allDay(name: string): CalendarEntry {
  return {
    ...timed(name, '00:00', '00:00'),
    allDay: true,
    allDayDate: '2026-10-08',
  };
}

const lanes = (entries: CalendarEntry[]): Record<string, string> =>
  Object.fromEntries(layoutDay(entries).map((item) => [item.entry.name, `${item.lane + 1}/${item.lanes}`]));

describe('a timed entry on its day', () => {
  it('takes its top and its height from its start and its length', () => {
    const [placed] = layoutDay([timed('A', '10:00', '11:30')]);
    expect(placed?.top).toBe(10 * HOUR_HEIGHT);
    expect(placed?.height).toBe(1.5 * HOUR_HEIGHT);
    expect(placed?.continues).toBe(false);
    expect(offsetOfMinute(7 * 60)).toBe(7 * HOUR_HEIGHT);
  });

  it('is never shorter than the minimum, so a 15-minute entry still shows its name', () => {
    const [placed] = layoutDay([timed('A', '09:00', '09:15')]);
    expect(offsetOfMinute(15)).toBeLessThan(MIN_ENTRY_HEIGHT);
    expect(placed?.height).toBe(MIN_ENTRY_HEIGHT);
    expect(placed?.top).toBe(9 * HOUR_HEIGHT);
  });

  it('is cut at midnight and flagged when it runs past it — 23:30 to 00:30', () => {
    const late = timed('A', '23:30', '00:30');
    expect(timedSpan(late)).toEqual({ startMinute: 23 * 60 + 30, endMinute: 24 * 60, continues: true });
    const [placed] = layoutDay([late]);
    expect(placed?.top).toBe(23.5 * HOUR_HEIGHT);
    expect(placed?.top ?? 0).toBeLessThan(24 * HOUR_HEIGHT);
    expect((placed?.top ?? 0) + (placed?.height ?? 0)).toBe(24 * HOUR_HEIGHT);
    expect(placed?.continues).toBe(true);
  });

  it('ends at midnight without being flagged when midnight is where it ends', () => {
    const untilMidnight = timed('A', '22:00', '00:00');
    expect(timedSpan(untilMidnight)).toEqual({ startMinute: 22 * 60, endMinute: 24 * 60, continues: false });
  });

  it('reads the wall clock on the days a clock changes', () => {
    // 29 March 2026, Warsaw: 01:30 (UTC+1) to 03:30 (UTC+2) is one hour long and two on the scale.
    const overTheGap: CalendarEntry = {
      ...timed('A', '00:00', '00:00'),
      startsAt: '2026-03-29T00:30:00.000Z',
      endsAt: '2026-03-29T01:30:00.000Z',
    };
    expect(timedSpan(overTheGap)).toEqual({ startMinute: 90, endMinute: 210, continues: false });
    // 25 October 2026: the second 02:30 to 02:45 — a quarter of an hour, on the scale at 02:30.
    const repeated: CalendarEntry = {
      ...timed('B', '00:00', '00:00'),
      startsAt: '2026-10-25T01:30:00.000Z',
      endsAt: '2026-10-25T01:45:00.000Z',
    };
    expect(timedSpan(repeated)).toEqual({ startMinute: 150, endMinute: 165, continues: false });
    // …and one that starts in the first 02:30 and ends in the second 02:10 is not given a negative length.
    const acrossTheRepeat: CalendarEntry = {
      ...timed('C', '00:00', '00:00'),
      startsAt: '2026-10-25T00:30:00.000Z',
      endsAt: '2026-10-25T01:10:00.000Z',
    };
    expect(timedSpan(acrossTheRepeat).endMinute).toBeGreaterThanOrEqual(timedSpan(acrossTheRepeat).startMinute);
    expect(layoutDay([acrossTheRepeat])[0]?.height).toBe(MIN_ENTRY_HEIGHT);
  });
});

describe('packing a day', () => {
  it('gives each entry the whole column when none overlap', () => {
    expect(lanes([timed('A', '09:00', '10:00'), timed('B', '10:00', '11:00'), timed('C', '13:00', '14:00')])).toEqual({
      A: '1/1',
      B: '1/1',
      C: '1/1',
    });
  });

  it('puts two overlapping entries side by side', () => {
    expect(lanes([timed('A', '09:00', '10:30'), timed('B', '10:00', '11:00')])).toEqual({ A: '1/2', B: '2/2' });
  });

  it('takes a chain A–B–C in two lanes, with C back in the first', () => {
    expect(
      lanes([timed('A', '09:00', '10:00'), timed('B', '09:30', '11:00'), timed('C', '10:15', '11:30')]),
    ).toEqual({ A: '1/2', B: '2/2', C: '1/2' });
  });

  it('gives six at once a sixth of the column each', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => timed(name, '12:00', '13:00'));
    const placed = layoutDay(six);
    expect(placed.map((item) => item.lanes)).toEqual([6, 6, 6, 6, 6, 6]);
    expect(placed.map((item) => item.lane).sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('starts a new cluster once the earlier one is over, so one busy hour does not narrow the day', () => {
    expect(
      lanes([
        timed('A', '09:00', '10:00'),
        timed('B', '09:00', '10:00'),
        timed('C', '09:00', '10:00'),
        timed('D', '14:00', '15:00'),
      ]),
    ).toEqual({ A: '1/3', B: '2/3', C: '3/3', D: '1/1' });
  });

  it('judges overlap by the drawn box, so two short entries a quarter of an hour apart do not print over each other', () => {
    expect(lanes([timed('A', '09:00', '09:15'), timed('B', '09:15', '09:30')])).toEqual({ A: '1/2', B: '2/2' });
    // Half an hour apart the minimum-height box is over.
    expect(lanes([timed('A', '09:00', '09:15'), timed('B', '09:30', '09:45')])).toEqual({ A: '1/1', B: '1/1' });
  });

  it('answers in order of time whatever order it was given, and leaves all-day entries out', () => {
    const placed = layoutDay([timed('C', '15:00', '16:00'), allDay('Fair'), timed('A', '08:00', '09:00'), timed('B', '11:00', '12:00')]);
    expect(placed.map((item) => item.entry.name)).toEqual(['A', 'B', 'C']);
  });

  it('never lets two entries of one lane overlap, and never uses a lane it did not count — a hundred random days', () => {
    let seed = 20261008;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const hhmm = (minute: number): string =>
      `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    for (let round = 0; round < 100; round += 1) {
      const entries = Array.from({ length: 1 + Math.floor(random() * 14) }, (_, index) => {
        const start = Math.floor(random() * 22 * 4) * 15;
        const length = (1 + Math.floor(random() * 8)) * 15;
        return timed(`E${String(index).padStart(2, '0')}`, hhmm(start), hhmm(Math.min(start + length, 23 * 60 + 45)));
      }).filter((item) => item.endsAt > item.startsAt);
      const placed = layoutDay(entries);
      expect(placed).toHaveLength(entries.length);
      for (const a of placed) {
        expect(a.lane).toBeLessThan(a.lanes);
        for (const b of placed) {
          if (a === b) continue;
          const overlap = a.top < b.top + b.height && b.top < a.top + a.height;
          if (overlap) {
            expect(a.lane === b.lane, `${a.entry.name} / ${b.entry.name}`).toBe(false);
            expect(a.lanes).toBe(b.lanes);
          }
        }
      }
    }
  });
});

describe('a month cell', () => {
  it('shows three and counts the rest, all-day first', () => {
    const cell = monthCell([
      timed('D', '15:00', '16:00'),
      timed('B', '09:00', '10:00'),
      allDay('Fair'),
      timed('C', '11:00', '12:00'),
      timed('E', '17:00', '18:00'),
    ]);
    expect(cell.shown.map((item) => item.name)).toEqual(['Fair', 'B', 'C']);
    expect(cell.more).toBe(2);
  });

  it('counts nothing when everything fits', () => {
    expect(monthCell([timed('A', '09:00', '10:00')])).toEqual({ shown: [expect.objectContaining({ name: 'A' })], more: 0 });
    expect(monthCell([])).toEqual({ shown: [], more: 0 });
    expect(monthCell([timed('A', '09:00', '10:00'), timed('B', '09:00', '10:00'), timed('C', '09:00', '10:00')]).more).toBe(0);
  });
});
