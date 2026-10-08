import {
  CreateOpportunityEventRequestSchema,
  OPPORTUNITY_EVENT_MAX_SPAN_HOURS,
  opportunityEventRuleSchema,
  type CreateOpportunityEventRequest,
  type OpportunityEvent,
  type OpportunityEventRule,
  type UpdateOpportunityEventRequest,
} from '@endora-commerce/contracts';
import {
  addDays,
  dateTimeValueOf,
  dayKeyOf,
  entryDayKey,
  isDayKey,
  localDate,
  timeValueOf,
  type DayKey,
} from './date-math.js';

/**
 * The Event dialog's arithmetic
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1b — *The
 * dialog*; FR-130, FR-131, FR-137): what the form opens with, what it sends,
 * and what it refuses before sending.
 *
 * The form holds what its native controls hold — a date, two times, a
 * `datetime-local` — all in the browser's zone. The instants the API takes are
 * built here, once, on the way out.
 */

export interface EventFormValues {
  name: string;
  description: string;
  allDay: boolean;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`; not asked for while `allDay`. */
  from: string;
  /** `HH:mm`. `00:00` after a later *From* is the midnight that ends the day. */
  to: string;
  remind: boolean;
  /** `YYYY-MM-DDTHH:mm`. */
  remindAt: string;
}

export type EventFormField = 'name' | 'date' | 'from' | 'to' | 'remindAt' | 'form';

/** A message key of the module's bundle, per field that is refused. */
export type EventFormErrors = Partial<Record<EventFormField, string>>;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)/;
const MINUTES_PER_DAY = 24 * 60;

/** The hour a reminder of an all-day Event is offered at (FR-137). */
export const ALL_DAY_REMINDER_TIME = '09:00';
/** The hour a new Event on a later day is offered at. */
const DEFAULT_START_TIME = '09:00';

function minutesOf(time: string): number | null {
  const match = TIME.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(minutes, MINUTES_PER_DAY - 1));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * *To* after *From* moved: the Event keeps its length. A length that would run
 * past the day ends at midnight (`00:00`) when it lands there exactly, and at
 * 23:59 otherwise — an Event is one day (FR-131).
 */
export function shiftedTo(from: string, to: string, nextFrom: string): string {
  const [fromMinutes, toMinutes, nextMinutes] = [minutesOf(from), minutesOf(to), minutesOf(nextFrom)];
  if (fromMinutes === null || toMinutes === null || nextMinutes === null) return to;
  const end = toMinutes === 0 && fromMinutes > 0 ? MINUTES_PER_DAY : toMinutes;
  const length = end - fromMinutes;
  if (length <= 0) return to;
  const next = nextMinutes + length;
  return next === MINUTES_PER_DAY ? '00:00' : timeOf(next);
}

/**
 * What a new Event opens with: today — or the day after the Opportunity's
 * latest Event, whichever is later — from the next whole hour, for an hour.
 * On a later day there is no "next hour", so it opens at 09:00.
 */
export function defaultEventForm(now: Date, events: readonly OpportunityEvent[]): EventFormValues {
  const today = dayKeyOf(now);
  const latest = events.reduce<DayKey | null>((found, event) => {
    const day = entryDayKey(event);
    return found === null || day > found ? day : found;
  }, null);
  const afterLatest = latest === null ? today : addDays(latest, 1);
  const date = afterLatest > today ? afterLatest : today;
  const from = date === today ? timeOf(Math.min(now.getHours() + 1, 23) * 60) : DEFAULT_START_TIME;
  return {
    name: '',
    description: '',
    allDay: false,
    date,
    from,
    to: shiftedTo('00:00', '01:00', from),
    remind: false,
    remindAt: '',
  };
}

/** An Event as the form shows it, in the browser's zone. */
export function eventFormOf(event: OpportunityEvent): EventFormValues {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  return {
    name: event.name,
    description: event.description ?? '',
    allDay: event.allDay,
    date: entryDayKey(event),
    from: event.allDay ? DEFAULT_START_TIME : timeValueOf(start),
    to: event.allDay ? shiftedTo('00:00', '01:00', DEFAULT_START_TIME) : timeValueOf(end),
    remind: event.reminder !== null,
    remindAt: event.reminder ? dateTimeValueOf(new Date(event.reminder.at)) : '',
  };
}

/**
 * The reminder time the form offers: the Event's start, or 09:00 on its date
 * when it is all day (FR-137). Empty while the start is not yet a moment.
 */
export function defaultRemindAt(values: Pick<EventFormValues, 'allDay' | 'date' | 'from'>): string {
  if (!isDayKey(values.date)) return '';
  if (values.allDay) return `${values.date}T${ALL_DAY_REMINDER_TIME}`;
  return minutesOf(values.from) === null ? '' : `${values.date}T${values.from}`;
}

/** The instant a `datetime-local` value names in the browser's zone. */
export function instantOfDateTimeValue(value: string): Date | null {
  const match = DATE_TIME.exec(value);
  if (!match || !isDayKey(match[1])) return null;
  return localDate(match[1], Number(match[2]), Number(match[3]));
}

/**
 * The Event's two instants: for *all day*, the local midnight that starts the
 * date and the next one; otherwise the date at *From* and at *To*.
 */
export function instantsOf(
  values: Pick<EventFormValues, 'allDay' | 'date' | 'from' | 'to'>,
): { startsAt: Date; endsAt: Date } | null {
  if (!isDayKey(values.date)) return null;
  if (values.allDay) {
    return { startsAt: localDate(values.date), endsAt: localDate(addDays(values.date, 1)) };
  }
  const [from, to] = [minutesOf(values.from), minutesOf(values.to)];
  if (from === null || to === null) return null;
  return {
    startsAt: localDate(values.date, Math.floor(from / 60), from % 60),
    endsAt:
      to === 0 && from > 0
        ? localDate(addDays(values.date, 1))
        : localDate(values.date, Math.floor(to / 60), to % 60),
  };
}

function reminderChanged(values: EventFormValues, initial: EventFormValues | null): boolean {
  return initial === null || !initial.remind || initial.remindAt !== values.remindAt;
}

/**
 * What the form refuses before anything is sent — the contract's own rules
 * (end after start, at most 25 hours), plus what only a form can miss.
 *
 * `initial` is the Event being edited, as the form opened: a reminder time that
 * was not touched is not judged against the clock, so an Event whose reminder
 * was already sent can still have its name corrected
 * (`contracts/admin-api.md` §12d).
 */
export function validateEventForm(
  values: EventFormValues,
  now: Date,
  initial: EventFormValues | null = null,
): EventFormErrors {
  const errors: EventFormErrors = {};
  if (values.name.trim().length === 0) errors.name = 'events.error.nameRequired';
  if (!isDayKey(values.date)) errors.date = 'events.error.dateRequired';
  if (!values.allDay) {
    if (minutesOf(values.from) === null) errors.from = 'events.error.timeRequired';
    if (minutesOf(values.to) === null) errors.to = 'events.error.timeRequired';
  }
  const instants = instantsOf(values);
  if (instants) {
    const span = instants.endsAt.getTime() - instants.startsAt.getTime();
    if (span <= 0) errors.to = 'events.error.ends_before_start';
    else if (span > OPPORTUNITY_EVENT_MAX_SPAN_HOURS * 3_600_000) errors.to = 'events.error.spans_days';
  }
  if (values.remind) {
    const remindAt = instantOfDateTimeValue(values.remindAt);
    if (remindAt === null) errors.remindAt = 'events.error.remindAtRequired';
    else if (reminderChanged(values, initial) && remindAt.getTime() <= now.getTime()) {
      errors.remindAt = 'events.error.reminder_in_past';
    }
  }
  return errors;
}

/** The body of a create. `null` when the form does not hold one — `validateEventForm` says why. */
export function createEventBody(
  values: EventFormValues,
  timeZone: string,
): CreateOpportunityEventRequest | null {
  const instants = instantsOf(values);
  if (!instants) return null;
  const remindAt = values.remind ? instantOfDateTimeValue(values.remindAt) : null;
  const parsed = CreateOpportunityEventRequestSchema.safeParse({
    name: values.name,
    description: values.description.trim() === '' ? null : values.description,
    allDay: values.allDay,
    startsAt: instants.startsAt.toISOString(),
    endsAt: instants.endsAt.toISOString(),
    timeZone,
    remindAt: remindAt ? remindAt.toISOString() : null,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The body of an edit: **only what changed**, judged in the form's own terms.
 *
 * The times are compared as the form shows them, not as instants: an all-day
 * Event made in another zone has instants that are not this browser's
 * midnights, and re-sending them "unchanged" would move its date. When any of
 * the four that make up the time changes, all four go together with this
 * browser's zone — the rules are judged on the Event as a whole.
 */
export function updateEventBody(
  event: OpportunityEvent,
  values: EventFormValues,
  timeZone: string,
): UpdateOpportunityEventRequest {
  const initial = eventFormOf(event);
  const body: UpdateOpportunityEventRequest = {};
  if (values.name.trim() !== event.name) body.name = values.name.trim();
  const description = values.description.trim() === '' ? null : values.description;
  if (description !== event.description) body.description = description;
  const timeChanged =
    values.allDay !== initial.allDay ||
    values.date !== initial.date ||
    (!values.allDay && (values.from !== initial.from || values.to !== initial.to));
  const instants = instantsOf(values);
  if (timeChanged && instants) {
    body.allDay = values.allDay;
    body.startsAt = instants.startsAt.toISOString();
    body.endsAt = instants.endsAt.toISOString();
    body.timeZone = timeZone;
  }
  if (!values.remind) {
    if (event.reminder !== null) body.remindAt = null;
  } else if (reminderChanged(values, initial)) {
    const remindAt = instantOfDateTimeValue(values.remindAt);
    if (remindAt) body.remindAt = remindAt.toISOString();
  }
  return body;
}

/** `details.rule` of a 422, when it is one the contract names. */
export function ruleOfDetails(details: unknown): OpportunityEventRule | null {
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
  const parsed = opportunityEventRuleSchema.safeParse((details as Record<string, unknown>)['rule']);
  return parsed.success ? parsed.data : null;
}

/**
 * The form field a refused member belongs under. `details.field` names a
 * member of the request; the form has a date and two times where the request
 * has two instants.
 */
export function fieldOfDetails(details: unknown, allDay: boolean): EventFormField {
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return 'form';
  switch ((details as Record<string, unknown>)['field']) {
    case 'name':
      return 'name';
    case 'startsAt':
      return allDay ? 'date' : 'from';
    case 'endsAt':
      return allDay ? 'date' : 'to';
    case 'allDay':
      return 'date';
    case 'remindAt':
      return 'remindAt';
    default:
      return 'form';
  }
}
