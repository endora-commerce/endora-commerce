/**
 * How the analytics screen says a number of days and a share, and which days a
 * range preset means. Pure functions: the screen's tests and the screen read
 * the same ones. The range presets are CRM's (`crm/…/lib/analytics-format.ts`),
 * copied — a module may not import another module's internals.
 */

/** A number of days in the language on screen, to one decimal; `Intl` supplies the unit and its plural. */
export function daysLabel(days: number, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
    maximumFractionDigits: 1,
  }).format(Math.max(0, days));
}

/** A share of a whole (0 – 1) as a whole percentage. */
export function percentLabel(share: number, language: string): string {
  return new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(share);
}

/** Days to two decimals — what a chart axis in days plots. */
export function chartDays(days: number): number {
  return Math.round(Math.max(0, days) * 100) / 100;
}

export const RANGE_PRESETS = ['thisMonth', 'lastMonth', 'last90Days', 'thisYear', 'custom'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DayRange {
  /** `YYYY-MM-DD`, included. */
  from: string;
  /** `YYYY-MM-DD`, included. */
  to: string;
}

function isoDay(year: number, month: number, day: number): string {
  // `Date.UTC` normalises an overflowing month or day (day 0 = the last of the month before).
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** The calendar day `now` falls on in `timeZone` — or on this computer's own calendar without one. */
function todayIn(now: Date, timeZone: string | null | undefined): { year: number; month: number; day: number } {
  const local = { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() };
  if (!timeZone) return local;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  } catch {
    // A zone this browser's time-zone data does not have: its own calendar is the best left.
    return local;
  }
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: part('year'), month: part('month') - 1, day: part('day') };
}

/**
 * The days a preset means. "Today" is the day it is in `timeZone` — the
 * reporting time zone the server counts in, which every figure names (issue
 * #475) — so a preset and the server's counting agree around midnight; until
 * the screen knows that zone, the operator's own calendar. `custom` has no
 * days of its own: the screen keeps whatever range was on it.
 */
export function presetRange(
  preset: Exclude<RangePreset, 'custom'>,
  options: { timeZone?: string | null; now?: Date } = {},
): DayRange {
  const { year, month, day } = todayIn(options.now ?? new Date(), options.timeZone);
  switch (preset) {
    case 'thisMonth':
      return { from: isoDay(year, month, 1), to: isoDay(year, month + 1, 0) };
    case 'lastMonth':
      return { from: isoDay(year, month - 1, 1), to: isoDay(year, month, 0) };
    case 'last90Days':
      return { from: isoDay(year, month, day - 89), to: isoDay(year, month, day) };
    case 'thisYear':
      return { from: isoDay(year, 0, 1), to: isoDay(year, 11, 31) };
  }
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Two calendar days, the first not after the second. */
export function isDayRange(range: DayRange): boolean {
  return CALENDAR_DAY.test(range.from) && CALENDAR_DAY.test(range.to) && range.from <= range.to;
}
