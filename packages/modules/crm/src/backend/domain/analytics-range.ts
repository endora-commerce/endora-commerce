/**
 * The range of CRM analytics — pure domain (issue #474).
 *
 * A range is two calendar days, both included, counted in the **reporting
 * time zone** — the `analytics` module's setting `analytics.reporting_time_zone`,
 * `UTC` unless an operator chose another, and `UTC` while `analytics` is off
 * (owner ruling of 2026-10-27). It is answered as a half-open interval of
 * instants an index on a `timestamptz` column can use:
 * `[from 00:00, the day after to 00:00)`, both midnights in that zone. In
 * `UTC` that is exactly the range CRM counted before it read the setting.
 *
 * The computation is Projects' `domain/analytics-range.ts`, written again
 * here — a module may not import another module's internals.
 */

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function calendarDay(day: string): { year: number; month: number; day: number } {
  const match = CALENDAR_DAY.exec(day);
  if (!match) throw new RangeError(`"${day}" is not a calendar date (YYYY-MM-DD).`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // Throws a `RangeError` for a zone the runtime does not know.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall clock of `instant` in `timeZone`, read back as if it were UTC. */
function wallClock(instant: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
}

/**
 * The first instant of a calendar day in `timeZone`: its midnight, or — where
 * a change of offset skips midnight — the first moment the day has. The
 * offset is read twice, because the offset at UTC midnight may not be the one
 * at the zone's midnight.
 */
function startOfDay(day: { year: number; month: number; day: number }, timeZone: string): Date {
  const asUtc = Date.UTC(day.year, day.month - 1, day.day);
  if (timeZone === 'UTC') return new Date(asUtc);
  const offsetAt = (instant: number) => wallClock(instant, timeZone) - instant;
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  const ofTheDay = (instant: number) => Math.floor(wallClock(instant, timeZone) / MS_PER_DAY) === asUtc / MS_PER_DAY;
  const candidates = [first, second].filter(ofTheDay);
  return new Date(candidates.length > 0 ? Math.min(...candidates) : Math.max(first, second));
}

/**
 * The instants a range of days covers in `timeZone`: `start` included, `end`
 * excluded. Throws `RangeError` for a day that is not one and for a range
 * that ends before it starts — the service answers both as 422 — and for a
 * zone the runtime does not know (the setting's validator refuses one first).
 */
export function analyticsRange(range: { from: string; to: string }, timeZone: string): { start: Date; end: Date } {
  const first = calendarDay(range.from);
  const last = calendarDay(range.to);
  if (range.to < range.from) throw new RangeError('The range ends before it starts.');
  const after = new Date(Date.UTC(last.year, last.month - 1, last.day) + MS_PER_DAY);
  return {
    start: startOfDay(first, timeZone),
    end: startOfDay({ year: after.getUTCFullYear(), month: after.getUTCMonth() + 1, day: after.getUTCDate() }, timeZone),
  };
}
