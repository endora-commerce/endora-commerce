import type { OpportunityEventRule } from '@endora-commerce/contracts';

/**
 * The time rules of an Event on an Opportunity
 * (`specs/143-crm-sales-opportunities/data-model.md` § *`crm_opportunity_events`*;
 * FR-131; research N-CAL1).
 *
 * An Event is stored as two instants and the IANA zone it was planned in. The
 * zone decides three things and nothing else: whether the two instants are one
 * calendar day, which date an all-day Event is, and how a time is worded where
 * there is no browser to localise it — a bell entry and an e-mail.
 *
 * **This file only ever formats an instant into a zone**
 * (`Intl.DateTimeFormat`, which Node does exactly). It never looks for the
 * instant of a local midnight: without a library that is an offset search, and
 * the browser does it with `new Date(y, m, d)`. So "is this a local midnight"
 * is asked as "is the millisecond before it another date" — true on a 23-hour
 * day, on a 25-hour one, and in a zone whose day starts at 01:00 because its
 * clocks go forward at midnight.
 */

export interface EventTime {
  allDay: boolean;
  startsAt: Date;
  /** Exclusive. */
  endsAt: Date;
  timeZone: string;
}

/** Why an Event's time is refused, and the member a form puts the sentence under. */
export interface EventTimeRefusal {
  rule: Extract<OpportunityEventRule, 'ends_before_start' | 'spans_days' | 'not_whole_day' | 'unknown_time_zone'>;
  field: 'startsAt' | 'endsAt' | 'timeZone';
}

/** Whether the runtime can format an instant into `timeZone`. */
export function isKnownTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    // `RangeError: Invalid time zone specified` — the one thing the
    // constructor throws for a string, and exactly the answer asked for.
    return false;
  }
}

/** The calendar date `instant` falls on in `timeZone`, as `YYYY-MM-DD`. */
function localDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  // `Intl` does not pad a year: 500 is "500", and a date is `YYYY-MM-DD`.
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/** Whether `instant` is the first instant of a calendar date in `timeZone`. */
function startsLocalDate(instant: Date, timeZone: string): boolean {
  return localDateOf(new Date(instant.getTime() - 1), timeZone) !== localDateOf(instant, timeZone);
}

/**
 * Judge an Event's time as it would be stored. `null` when it stands.
 *
 * In this order, so that one refusal is not reported as another: the zone
 * (nothing else can be judged without it), the end after the start, then the
 * one-day rule of the Event's kind.
 */
export function checkEventTime(event: EventTime): EventTimeRefusal | null {
  const { startsAt, endsAt, timeZone } = event;
  if (!isKnownTimeZone(timeZone)) return { rule: 'unknown_time_zone', field: 'timeZone' };
  if (endsAt.getTime() <= startsAt.getTime()) return { rule: 'ends_before_start', field: 'endsAt' };

  const lastInstant = new Date(endsAt.getTime() - 1);
  const sameLocalDay = localDateOf(startsAt, timeZone) === localDateOf(lastInstant, timeZone);

  if (!event.allDay) return sameLocalDay ? null : { rule: 'spans_days', field: 'endsAt' };

  // A date: from its first instant to the first instant of the next — 23, 24
  // or 25 hours, whichever that date is in this zone.
  if (!startsLocalDate(startsAt, timeZone)) return { rule: 'not_whole_day', field: 'startsAt' };
  if (!sameLocalDay || !startsLocalDate(endsAt, timeZone)) return { rule: 'not_whole_day', field: 'endsAt' };
  return null;
}

/**
 * The date of an all-day Event: the local date of its start in its own zone.
 * A calendar places the Event on this date whatever the reader's zone.
 */
export function allDayDateOf(startsAt: Date, timeZone: string): string {
  return localDateOf(startsAt, timeZone);
}

/** The languages a reminder is worded in — the two an Admin UI is drawn in. */
export type EventWhenLanguage = 'en-US' | 'pl-PL';

/**
 * When an Event starts, in words that need no browser and in the language of
 * whoever is told (owner ruling of 2026-10-08): the date and the time **in the
 * Event's own zone**, with the zone named beside them — "October 8, 2026,
 * 6:42 PM (Europe/Warsaw)", and the Polish of it for a Polish reader — and the
 * date alone for an all-day one: a date is the same date for every reader
 * (FR-131), so a zone beside it would say something untrue.
 *
 * Worded here and not where it is read: a bell param is a string the shell
 * substitutes and never formats, and an e-mail has no reader's browser at all.
 * A reminder has one recipient, so "the reader's language" is theirs.
 *
 * One line of plain text: `Intl` puts a narrow no-break space before "PM",
 * which a subject line and a bell sentence are better without.
 */
export function eventWhen(
  event: Pick<EventTime, 'allDay' | 'startsAt' | 'timeZone'>,
  language: EventWhenLanguage,
): string {
  const { startsAt, timeZone } = event;
  const plain = (text: string): string => text.replace(/\s+/gu, ' ').trim();
  const date = plain(
    new Intl.DateTimeFormat(language, { timeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(startsAt),
  );
  if (event.allDay) return date;
  const time = plain(
    new Intl.DateTimeFormat(language, {
      timeZone,
      // Midnight is 00:00 in Polish and 12:00 AM in English, never 0:00 or 24:00.
      hour: language === 'pl-PL' ? '2-digit' : 'numeric',
      minute: '2-digit',
    }).format(startsAt),
  );
  return `${date}, ${time} (${timeZone})`;
}
