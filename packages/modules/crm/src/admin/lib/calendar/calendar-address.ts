import { calendarScopeSchema, type CalendarScope } from '@endora-commerce/contracts';
import { CALENDAR_VIEWS, isDayKey, type CalendarView, type DayKey } from './date-math.js';

/**
 * The Calendar page's address
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §1b; FR-146):
 * `?view=month|week|day|agenda&date=YYYY-MM-DD&scope=mine|all`.
 *
 * **The defaults are written as nothing.** A bare `/crm/calendar` is "this
 * month, today, whatever the server shows me by default" — on whichever day it
 * is opened — so the address somebody bookmarks from the sidebar keeps meaning
 * *now*. Anything else is spelled out, so a reload or a shared link shows the
 * same view of the same date.
 */

export const DEFAULT_CALENDAR_VIEW: CalendarView = 'month';

export const VIEW_PARAM = 'view';
export const DATE_PARAM = 'date';
export const SCOPE_PARAM = 'scope';

export interface CalendarAddress {
  view: CalendarView;
  date: DayKey;
  /** `null` = not asked: the server applies the caller's default. */
  scope: CalendarScope | null;
}

function isView(value: string | null): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value ?? '');
}

/** What an address asks for; anything absent or malformed is the default. */
export function readCalendarAddress(search: URLSearchParams, today: DayKey): CalendarAddress {
  const view = search.get(VIEW_PARAM);
  const date = search.get(DATE_PARAM);
  const scope = calendarScopeSchema.safeParse(search.get(SCOPE_PARAM));
  return {
    view: isView(view) ? view : DEFAULT_CALENDAR_VIEW,
    date: isDayKey(date) ? date : today,
    scope: scope.success ? scope.data : null,
  };
}

/** The query string for an address, keeping every parameter that is not the calendar's. */
export function writeCalendarAddress(
  search: URLSearchParams,
  address: CalendarAddress,
  today: DayKey,
): URLSearchParams {
  const next = new URLSearchParams(search);
  if (address.view === DEFAULT_CALENDAR_VIEW) next.delete(VIEW_PARAM);
  else next.set(VIEW_PARAM, address.view);
  if (address.date === today) next.delete(DATE_PARAM);
  else next.set(DATE_PARAM, address.date);
  if (address.scope === null) next.delete(SCOPE_PARAM);
  else next.set(SCOPE_PARAM, address.scope);
  return next;
}
