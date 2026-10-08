import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CalendarEventsResponseSchema, OpportunityEventResponseSchema, type CalendarEventsResponse, type OpportunityEvent } from '@endora-commerce/contracts';
import { CRM_ADMIN, CRM_API } from './seed-crm.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Fixtures for Events on an Opportunity and the Calendar
 * (`specs/143-crm-sales-opportunities/` User Stories 21 and 22).
 *
 * An Event is given as instants and a zone, as the Admin UI sends it: the
 * server never looks for a local midnight, so neither do these helpers. The
 * dates the tests use are far in the future (or the past) on purpose — "not yet
 * ended" must not depend on the day the suite runs.
 */

/** 10:00 – 11:00 in Warsaw on a summer day (UTC+2), as the body of a create. */
export function timedEventBody(
  day: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'Call the buyer',
    allDay: false,
    startsAt: `${day}T08:00:00.000Z`,
    endsAt: `${day}T09:00:00.000Z`,
    timeZone: 'Europe/Warsaw',
    ...overrides,
  };
}

/** `POST /opportunities/:id/events`; fails the test on anything but 201. */
export async function createCrmEvent(
  h: BackendServerHandle,
  opportunityId: string,
  body: Record<string, unknown>,
  cookies: Record<string, string> = CRM_ADMIN,
): Promise<OpportunityEvent> {
  const response = await h.app.inject({
    method: 'POST',
    url: `${CRM_API}/opportunities/${opportunityId}/events`,
    cookies,
    payload: body,
  });
  if (response.statusCode !== 201) throw new Error(`createCrmEvent: ${response.statusCode} ${response.body}`);
  return OpportunityEventResponseSchema.parse(response.json()).data;
}

/** `GET /calendar/events`; fails the test on anything but 200 and answers the parsed body. */
export async function readCrmCalendar(
  h: BackendServerHandle,
  query: { from: string; to: string; scope?: string },
  cookies: Record<string, string> = CRM_ADMIN,
): Promise<CalendarEventsResponse> {
  const params = new URLSearchParams({ from: query.from, to: query.to });
  if (query.scope) params.set('scope', query.scope);
  const response = await h.app.inject({
    method: 'GET',
    url: `${CRM_API}/calendar/events?${params.toString()}`,
    cookies,
  });
  if (response.statusCode !== 200) throw new Error(`readCrmCalendar: ${response.statusCode} ${response.body}`);
  return CalendarEventsResponseSchema.parse(response.json());
}

/**
 * An Event written straight to the table — for what no request can produce: a
 * reminder already due, a reminder already handled, five hundred rows at once.
 * Answers the row's id.
 */
export async function seedCrmEventRow(
  em: EntityManager,
  opportunityId: string,
  row: {
    name?: string;
    description?: string | null;
    allDay?: boolean;
    startsAt: Date;
    endsAt: Date;
    timeZone?: string;
    remindAt?: Date | null;
    reminderHandledAt?: Date | null;
    reminderOutcome?: string | null;
    createdByAdminUserId?: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await em.getConnection().execute(
    `insert into "crm_opportunity_events"
       ("id", "opportunity_id", "name", "description", "all_day", "starts_at", "ends_at", "time_zone",
        "remind_at", "reminder_handled_at", "reminder_outcome", "created_by_admin_user_id", "created_at", "updated_at")
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
    [
      id,
      opportunityId,
      row.name ?? 'Seeded event',
      row.description ?? null,
      row.allDay ?? false,
      row.startsAt,
      row.endsAt,
      row.timeZone ?? 'Europe/Warsaw',
      row.remindAt ?? null,
      row.reminderHandledAt ?? null,
      row.reminderOutcome ?? null,
      row.createdByAdminUserId ?? null,
    ],
  );
  return id;
}

/** The reminder columns of one Event, read past every filter. */
export async function crmEventReminderRow(
  em: EntityManager,
  eventId: string,
): Promise<{ remindAt: Date | null; handledAt: Date | null; outcome: string | null; updatedAt: Date } | null> {
  const rows = (await em.getConnection().execute(
    `select "remind_at", "reminder_handled_at", "reminder_outcome", "updated_at"
       from "crm_opportunity_events" where "id" = ?`,
    [eventId],
  )) as Array<{ remind_at: Date | null; reminder_handled_at: Date | null; reminder_outcome: string | null; updated_at: Date }>;
  const row = rows[0];
  if (!row) return null;
  // The driver may hand a `timestamptz` back as text; a caller compares instants.
  const instant = (value: Date | string | null): Date | null => (value === null ? null : new Date(value));
  return {
    remindAt: instant(row.remind_at),
    handledAt: instant(row.reminder_handled_at),
    outcome: row.reminder_outcome,
    updatedAt: instant(row.updated_at) as Date,
  };
}
