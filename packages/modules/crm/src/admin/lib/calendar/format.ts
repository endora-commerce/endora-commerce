import { localDate, type DayKey } from './date-math.js';

/**
 * How the calendar writes a day and a time, in the language on screen and the
 * browser's zone. `Intl.DateTimeFormat` objects are not cheap to build and a
 * month grid asks for 42 day numbers, so each is made once per language.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${name}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

/** "10:00" / "10:00 AM" — the hour and the minute of an instant. */
export function timeLabel(date: Date, locale: string): string {
  return formatter(locale, 'time', { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "Thursday, October 8" — a day as a heading names it. */
export function dayHeadingLabel(day: DayKey, locale: string): string {
  return formatter(locale, 'heading', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    localDate(day, 12),
  );
}

/** "Thursday, October 8, 2026" — a day in full, where the year is not on screen beside it. */
export function fullDayLabel(day: DayKey, locale: string): string {
  return formatter(locale, 'full', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(localDate(day, 12));
}

/** "Thu" and "8" — what the head of a week column shows. */
export function shortWeekdayLabel(day: DayKey, locale: string): string {
  return formatter(locale, 'weekdayShort', { weekday: 'short' }).format(localDate(day, 12));
}

export function longWeekdayLabel(day: DayKey, locale: string): string {
  return formatter(locale, 'weekdayLong', { weekday: 'long' }).format(localDate(day, 12));
}

export function dayNumberLabel(day: DayKey, locale: string): string {
  return formatter(locale, 'dayNumber', { day: 'numeric' }).format(localDate(day, 12));
}

/** "Oct 8, 2026, 10:00" — a date and a time in one, for a list row or a reminder. */
export function dateTimeLabel(date: Date, locale: string): string {
  return formatter(locale, 'dateTime', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** The browser's zone as a person names it: "Europe/Warsaw (CEST)". */
export function timeZoneLabel(locale: string, at: Date = new Date()): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const short = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  return short && short !== zone ? `${zone.replace(/_/g, ' ')} (${short})` : zone.replace(/_/g, ' ');
}
