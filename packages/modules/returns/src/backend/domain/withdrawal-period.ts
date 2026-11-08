import type { OrderReturnContext } from '@endora-commerce/contracts';

/**
 * The consumer's withdrawal period — pure domain (issue #905, design D3).
 *
 * **The anchor.** The period runs from the moment the order entered its
 * fulfilment-completing status, as `orders` reports it
 * (`OrderReturnContext.completingStatusEnteredAt`, stored once as
 * `orders.completed_at`). The law counts from the day the consumer takes
 * possession of the goods (Directive 2011/83 art. 9(2)(b)); the platform has no
 * delivery signal (a shipment's `success` is the carrier accepting the parcel,
 * which is earlier, so counting from it would shorten the period), and the
 * operator completing the order is the closest fact it has. `null` means the
 * order has not been completed: the period **has not started**, so a statement
 * is in time by definition. Every window `returns` judges goes through
 * {@link withdrawalPeriodAnchor}, so a true delivery date, when one exists,
 * changes one line. `shipments` is not read, so its off-state changes nothing.
 *
 * **Counting.** Calendar days in `returns.time_zone` (Regulation 1182/71, which
 * 2011/83 recital 41 applies): the anchor's own day is not counted, the period
 * ends at the end of its last day, and a last day on a Saturday or Sunday moves
 * to the following Monday. Public holidays are not modelled — there is no
 * calendar — and the grace below covers them.
 *
 * **The grace.** The operator may complete an order before the parcel arrives,
 * so the withdrawal function stays available for {@link WITHDRAWAL_GRACE_DAYS}
 * calendar days after the later of the statutory end and the channel's
 * free-return window (owner ruling on #905, 2026-11-07). A statement made in the
 * grace is accepted, and is outside the statutory period for the operator to
 * judge.
 */

/** The statutory withdrawal period, in days (Directive 2011/83 art. 9(1); PL art. 27). */
export const STATUTORY_WITHDRAWAL_DAYS = 14;

/** Calendar days the withdrawal function stays available after the period ends (owner ruling on #905). */
export const WITHDRAWAL_GRACE_DAYS = 7;

/** The anchor every window in `returns` counts from; `null` = the period has not started. */
export function withdrawalPeriodAnchor(ctx: Pick<OrderReturnContext, 'completingStatusEnteredAt'>): Date | null {
  return ctx.completingStatusEnteredAt;
}

export interface WithdrawalPeriod {
  /** The anchor; `null` = the order has not been completed and the period has not started. */
  readonly startsAt: Date | null;
  /** The last instant of the statutory period; `null` while it has not started. */
  readonly endsAt: Date | null;
  /** The last instant of the channel's free-return window; `null` while not started, or when the channel offers none. */
  readonly freeWindowEndsAt: Date | null;
  /** The last instant the withdrawal function is available: the later end plus the grace; `null` while not started. */
  readonly availableUntil: Date | null;
}

export interface WithdrawalPeriodSettings {
  /** `returns.time_zone`, an IANA name. */
  readonly timeZone: string;
  /** `returns.free_return_days` for the order's channel; `0` = no free-return option. */
  readonly freeReturnDays: number;
}

/** The withdrawal period of an order completed at `anchor`. */
export function withdrawalPeriod(anchor: Date | null, settings: WithdrawalPeriodSettings): WithdrawalPeriod {
  if (anchor === null) return { startsAt: null, endsAt: null, freeWindowEndsAt: null, availableUntil: null };
  const endsAt = periodEndAfter(anchor, STATUTORY_WITHDRAWAL_DAYS, settings.timeZone);
  const freeWindowEndsAt = hasFreeWindow(settings.freeReturnDays)
    ? periodEndAfter(anchor, settings.freeReturnDays, settings.timeZone)
    : null;
  const later = freeWindowEndsAt !== null && freeWindowEndsAt > endsAt ? freeWindowEndsAt : endsAt;
  return {
    startsAt: anchor,
    endsAt,
    freeWindowEndsAt,
    availableUntil: endOfDay(addDays(calendarDay(later, settings.timeZone), WITHDRAWAL_GRACE_DAYS), settings.timeZone),
  };
}

/** Whether `at` falls in the statutory period. Always `true` before the period has started. */
export function isWithinStatutoryPeriod(period: WithdrawalPeriod, at: Date): boolean {
  return period.endsAt === null || at.getTime() <= period.endsAt.getTime();
}

/** Whether the withdrawal function is available at `at`. Always `true` before the period has started. */
export function isWithdrawalAvailableAt(period: WithdrawalPeriod, at: Date): boolean {
  return period.availableUntil === null || at.getTime() <= period.availableUntil.getTime();
}

/**
 * The last instant of a period of `days` calendar days after `anchor`'s day in
 * `timeZone`, with a last day on a Saturday or Sunday moved to the Monday.
 * Throws `RangeError` for a zone the runtime does not know.
 */
export function periodEndAfter(anchor: Date, days: number, timeZone: string): Date {
  const last = addDays(calendarDay(anchor, timeZone), days);
  const weekday = new Date(Date.UTC(last.year, last.month - 1, last.day)).getUTCDay();
  const rolled = weekday === 6 ? addDays(last, 2) : weekday === 0 ? addDays(last, 1) : last;
  return endOfDay(rolled, timeZone);
}

function hasFreeWindow(days: number): boolean {
  return Number.isFinite(days) && days > 0;
}

interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The calendar day `at` falls on in `timeZone`. */
function calendarDay(at: Date, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (type: 'year' | 'month' | 'day') => Number(parts.find((p) => p.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

function addDays(d: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** The last millisecond of `d` in `timeZone`: one before the next day's midnight there. */
function endOfDay(d: CalendarDay, timeZone: string): Date {
  const next = addDays(d, 1);
  const wallClock = Date.UTC(next.year, next.month - 1, next.day);
  // The offset at the wall-clock time read as UTC is right except across a
  // change between the two; asking again at the first answer settles it.
  const first = wallClock - offsetMinutes(timeZone, new Date(wallClock)) * 60_000;
  return new Date(wallClock - offsetMinutes(timeZone, new Date(first)) * 60_000 - 1);
}

/** How far `timeZone` is ahead of UTC at `at`, in minutes. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}
