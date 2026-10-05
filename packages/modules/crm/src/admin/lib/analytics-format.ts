/**
 * How the analytics screen says a duration, a month and a range of days.
 * Pure functions: the screen's tests and the screen read the same ones.
 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

function unit(value: number, name: 'minute' | 'hour' | 'day', language: string, digits: number): string {
  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: name,
    unitDisplay: 'long',
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * A duration as a person reads it, in the language on screen: minutes under an
 * hour, hours under two days, days from there on. `Intl` supplies the unit and
 * its plural form, so no unit word is hand-written in either language.
 */
export function durationLabel(seconds: number, language: string): string {
  const value = Math.max(0, seconds);
  if (value < HOUR) return unit(Math.round(value / MINUTE), 'minute', language, 0);
  if (value < 2 * DAY) return unit(value / HOUR, 'hour', language, 1);
  return unit(value / DAY, 'day', language, 1);
}

/** Seconds as days, to two decimals — what a chart axis in days plots. */
export function daysOf(seconds: number): number {
  return Math.round((Math.max(0, seconds) / DAY) * 100) / 100;
}

/** `YYYY-MM` as the month's name and the year, in the language on screen. */
export function monthLabel(month: string, language: string): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, index - 1, 1)),
  );
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

/**
 * The days a preset means, on the operator's own calendar. `custom` has no
 * days of its own: the screen keeps whatever range was on it.
 */
export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: Date = new Date()): DayRange {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
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
