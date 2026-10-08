import {
  CalendarEventSchema,
  CalendarEventsResponseSchema,
  OpportunityEventSchema,
  type CalendarEvent,
  type CalendarEventsMeta,
  type CalendarEventsResponse,
  type OpportunityEvent,
} from '@endora-commerce/contracts';
import type { CalendarEntry } from '../../../../packages/modules/crm/src/admin/lib/calendar/date-math';
import { ADMIN_ID, OPPORTUNITY_ID } from './crm-fixtures';

/**
 * Fixtures of the Events and Calendar screen tests
 * (`specs/143-crm-sales-opportunities/`, User Stories 21 and 22;
 * `contracts/admin-api.md` §12d).
 *
 * **The API these screens call was built on another branch.** What stands in
 * for it here is therefore not merely typed by the contract: every answer a
 * test hands a screen is **parsed with the contract's response schema** on the
 * way out of these builders, so a fixture that drifts from the contract fails
 * the test that uses it instead of teaching a screen a shape no route answers.
 *
 * The tests run in Europe/Warsaw at a fixed moment — Thursday 8 October 2026,
 * 12:00 local (UTC+2) — so "today", the current-time line and every local time
 * below are the same on every machine.
 */

export const WARSAW = 'Europe/Warsaw';

/** Thursday 8 October 2026, 12:00 in Warsaw. */
export const NOW = new Date('2026-10-08T10:00:00.000Z');
export const TODAY = '2026-10-08';

export const eventId = (n: number): string => `00000000-0000-4000-8000-0000000e${String(n).padStart(4, '0')}`;
export const opportunityId = (n: number): string => `00000000-0000-4000-8000-0000000b${String(n).padStart(4, '0')}`;

/** A Warsaw wall-clock time on a day of October 2026 (UTC+2 until the 25th), as the UTC instant the API answers. */
export function at(day: string, time: string): string {
  return new Date(`${day}T${time}:00+02:00`).toISOString();
}

let entrySequence = 0;

/** What the calendar component is handed. */
export function entry(name: string, day: string, from: string, to: string, overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  entrySequence += 1;
  const id = eventId(entrySequence);
  return {
    id,
    name,
    allDay: false,
    startsAt: at(day, from),
    endsAt: at(day, to),
    allDayDate: null,
    href: `/crm/opportunities/${OPPORTUNITY_ID}?tab=events&event=${id}`,
    context: 'OPP-000001 · Fleet renewal',
    hasReminder: false,
    ...overrides,
  };
}

export function allDayEntry(name: string, day: string, overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  const next = new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  return entry(name, day, '00:00', '00:00', {
    allDay: true,
    allDayDate: day,
    endsAt: at(next, '00:00'),
    ...overrides,
  });
}

/** One row of `GET /calendar/events`, parsed by the contract. */
export function calendarEvent(
  n: number,
  name: string,
  day: string,
  from: string,
  to: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return CalendarEventSchema.parse({
    id: eventId(n),
    name,
    allDay: false,
    startsAt: at(day, from),
    endsAt: at(day, to),
    allDayDate: null,
    hasReminder: false,
    opportunity: {
      id: opportunityId(1),
      number: 'OPP-000001',
      title: 'Fleet renewal',
      assignee: { id: ADMIN_ID, name: 'Anna Nowak' },
    },
    ...overrides,
  });
}

/** The whole answer of `GET /calendar/events`, parsed by the contract. */
export function calendarResponse(
  data: CalendarEvent[],
  meta: Partial<CalendarEventsMeta> = {},
): CalendarEventsResponse {
  return CalendarEventsResponseSchema.parse({
    data,
    meta: { scope: 'all', scopes: ['all', 'mine'], truncated: false, ...meta },
  });
}

/** One Event of an Opportunity, as the four Event routes answer it — parsed by the contract. */
export function opportunityEvent(
  n: number,
  name: string,
  day: string,
  from: string,
  to: string,
  overrides: Partial<OpportunityEvent> = {},
): OpportunityEvent {
  return OpportunityEventSchema.parse({
    id: eventId(n),
    opportunityId: OPPORTUNITY_ID,
    name,
    description: null,
    allDay: false,
    startsAt: at(day, from),
    endsAt: at(day, to),
    timeZone: WARSAW,
    allDayDate: null,
    reminder: null,
    createdBy: { id: ADMIN_ID, name: 'Anna Nowak' },
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  });
}
