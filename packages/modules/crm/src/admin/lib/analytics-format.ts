/**
 * How the analytics screen says a duration and a month. Pure functions: the
 * screen's tests and the screen read the same ones. The range presets are the
 * kit's (`@endora-commerce/admin-kit/lib`, issue #464).
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
