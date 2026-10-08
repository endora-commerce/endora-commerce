/**
 * The calendar's date arithmetic
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1b;
 * research N-CAL9).
 *
 * Pure functions over the **browser's local time**, through `Date` and
 * `Intl.DateTimeFormat` and nothing else — no date library (`plan.md` §
 * *Complexity Tracking*). A day is named by its `YYYY-MM-DD` key and every step
 * between days goes through the `Date` constructor's own calendar, never
 * through a multiple of 24 hours: the two days a year a clock changes are 23
 * and 25 hours long, and a week that contains one is not 168 hours.
 */

/** A calendar day in the reader's zone, `YYYY-MM-DD`. */
export type DayKey = string;

export const CALENDAR_VIEWS = ['month', 'week', 'day', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** How many days the agenda lists from its anchor. */
export const AGENDA_DAYS = 30;

/** Rows of the month grid: six, so its height never changes between months. */
export const MONTH_ROWS = 6;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * What a calendar draws for one Event, whoever asked: the Calendar page maps a
 * `CalendarEvent` to it and the Events tab an `OpportunityEvent`.
 */
export interface CalendarEntry {
  id: string;
  name: string;
  allDay: boolean;
  /** UTC instants; `endsAt` is exclusive. */
  startsAt: string;
  endsAt: string;
  /** The date of an all-day Event, the same for every reader; `null` for a timed one. */
  allDayDate: DayKey | null;
  /** Where a press leads — an address inside the Admin UI. */
  href: string;
  /** The second line of the entry's name: on the page, the Opportunity; on the tab, nothing. */
  context: string | null;
  hasReminder: boolean;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** The local calendar day an instant falls on. */
export function dayKeyOf(date: Date): DayKey {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parts(key: DayKey): [year: number, month: number, day: number] {
  const match = DAY_KEY.exec(key);
  if (!match) throw new RangeError(`Not a day key: ${key}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Whether a string names a day that exists (`2026-02-30` does not). */
export function isDayKey(value: string | null | undefined): value is DayKey {
  if (!value) return false;
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * A moment on a local day — midnight by default. Where the zone's clock skips
 * midnight itself, `Date` answers the first moment that exists, which is still
 * that day.
 */
export function localDate(key: DayKey, hours = 0, minutes = 0): Date {
  const [year, month, day] = parts(key);
  return new Date(year, month - 1, day, hours, minutes);
}

/** The day `amount` days after (or before) `key`, by the calendar. */
export function addDays(key: DayKey, amount: number): DayKey {
  const [year, month, day] = parts(key);
  return dayKeyOf(new Date(year, month - 1, day + amount, 12));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86_400_000,
  );
}

/**
 * The Monday of the week holding `key`. Monday first in both languages: ISO
 * 8601, Poland and a business week (research N-CAL10, OQ-9).
 */
export function weekStart(key: DayKey): DayKey {
  const weekday = localDate(key, 12).getDay(); // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7));
}

/** `count` consecutive days from `from`. */
export function daysFrom(from: DayKey, count: number): DayKey[] {
  return Array.from({ length: count }, (_, index) => addDays(from, index));
}

/** The seven days of the week holding `key`, Monday first. */
export function weekDays(key: DayKey): DayKey[] {
  return daysFrom(weekStart(key), 7);
}

/** The first day of the month holding `key`. */
export function monthStart(key: DayKey): DayKey {
  const [year, month] = parts(key);
  return `${pad(year, 4)}-${pad(month)}-01`;
}

/** Whether two days are in the same month of the same year. */
export function sameMonth(a: DayKey, b: DayKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** The month grid: six weeks of seven days from the Monday on or before the 1st. */
export function monthMatrix(key: DayKey): DayKey[][] {
  const first = weekStart(monthStart(key));
  return Array.from({ length: MONTH_ROWS }, (_, row) => daysFrom(addDays(first, row * 7), 7));
}

/** The days a view draws: `from` included, `to` excluded. */
export interface DayRange {
  from: DayKey;
  to: DayKey;
}

export function visibleRange(view: CalendarView, date: DayKey): DayRange {
  switch (view) {
    case 'month': {
      const from = weekStart(monthStart(date));
      return { from, to: addDays(from, MONTH_ROWS * 7) };
    }
    case 'week': {
      const from = weekStart(date);
      return { from, to: addDays(from, 7) };
    }
    case 'day':
      return { from: date, to: addDays(date, 1) };
    case 'agenda':
      return { from: date, to: addDays(date, AGENDA_DAYS) };
  }
}

/** Whether `outer` holds every day of `inner`. */
export function rangeCovers(outer: DayRange, inner: DayRange): boolean {
  return outer.from <= inner.from && inner.to <= outer.to;
}

/**
 * The instants to ask the Calendar for: the days drawn, **one day wider on each
 * side**. An all-day Event's instants are its date in its *own* zone, so for a
 * reader far to the east or west that date can begin outside the range their
 * own grid maps to (`contracts/admin-api.md` §12d). The widest — the month
 * grid — is 44 local days, inside the contract's 45.
 */
export function requestRange(range: DayRange): { from: Date; to: Date } {
  return { from: localDate(addDays(range.from, -1)), to: localDate(addDays(range.to, 1)) };
}

/**
 * The anchor one step before or after: a month, a week, a day, or the agenda's
 * thirty days. A month step keeps the day of the month where the month has it
 * (the 31st steps to the 30th or the 28th, not into the month after).
 */
export function shiftDate(view: CalendarView, date: DayKey, direction: -1 | 1): DayKey {
  switch (view) {
    case 'month': {
      const [year, month, day] = parts(date);
      const target = new Date(year, month - 1 + direction, 1, 12);
      const length = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
      return `${pad(target.getFullYear(), 4)}-${pad(target.getMonth() + 1)}-${pad(Math.min(day, length))}`;
    }
    case 'week':
      return addDays(date, 7 * direction);
    case 'day':
      return addDays(date, direction);
    case 'agenda':
      return addDays(date, AGENDA_DAYS * direction);
  }
}

/** The range a view shows, in words: "October 2026", "5 – 11 October 2026". */
export function rangeTitle(view: CalendarView, date: DayKey, locale: string): string {
  if (view === 'month') {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
      localDate(date, 12),
    );
  }
  if (view === 'day') {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(localDate(date, 12));
  }
  const { from, to } = visibleRange(view, date);
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).formatRange(localDate(from, 12), localDate(addDays(to, -1), 12));
}

/**
 * The day an entry is drawn on. An all-day Event is a **date** and is placed by
 * `allDayDate`, the same for every reader; a timed one is an instant and is
 * placed on the local day it starts on.
 */
export function entryDayKey(entry: Pick<CalendarEntry, 'allDay' | 'allDayDate' | 'startsAt'>): DayKey {
  if (entry.allDay && entry.allDayDate) return entry.allDayDate;
  return dayKeyOf(new Date(entry.startsAt));
}

/** All-day first, then by start, then by name and id — a total order, so a list never reshuffles. */
export function compareEntries(a: CalendarEntry, b: CalendarEntry): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const byStart = a.allDay ? 0 : Date.parse(a.startsAt) - Date.parse(b.startsAt);
  if (byStart !== 0) return byStart;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** Every entry under the day it is drawn on, each day in reading order. */
export function entriesByDay(entries: readonly CalendarEntry[]): Map<DayKey, CalendarEntry[]> {
  const days = new Map<DayKey, CalendarEntry[]>();
  for (const entry of entries) {
    const key = entryDayKey(entry);
    const day = days.get(key);
    if (day) day.push(entry);
    else days.set(key, [entry]);
  }
  for (const day of days.values()) day.sort(compareEntries);
  return days;
}

/** The entries drawn on the days of `range`, in reading order. */
export function entriesInRange(
  byDay: ReadonlyMap<DayKey, readonly CalendarEntry[]>,
  range: DayRange,
): CalendarEntry[] {
  const found: CalendarEntry[] = [];
  for (let day = range.from; day < range.to; day = addDays(day, 1)) {
    found.push(...(byDay.get(day) ?? []));
  }
  return found;
}

/** Minutes since local midnight, by the wall clock — what an hour scale shows. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** `HH:mm` of an instant in local time — the value of an `<input type="time">`. */
export function timeValueOf(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` of an instant in local time — the value of an `<input type="datetime-local">`. */
export function dateTimeValueOf(date: Date): string {
  return `${dayKeyOf(date)}T${timeValueOf(date)}`;
}
