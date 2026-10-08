import type { EntityManager } from '@mikro-orm/postgresql';
import {
  CALENDAR_EVENTS_MAX_RESULTS,
  OPPORTUNITY_EVENT_MAX_SPAN_HOURS,
  type AdminUserReadPort,
  type CalendarEvent,
  type CalendarEventsQuery,
  type CalendarEventsResponse,
  type CalendarScope,
} from '@endora-commerce/contracts';
import { orgConstraintFor, type OrgConstraint } from '@endora-commerce/platform/tenancy';
import { allDayDateOf } from '../domain/event-time.js';
import { analyticsScopePredicate } from './analytics-service.js';
import { actingAdminUserId } from './opportunity-assignment-service.js';

export interface CalendarServiceDeps {
  emFactory: () => EntityManager;
  /** `admin_users`' port — lazy, resolved per call, never captured. */
  adminUsers: AdminUserReadPort;
}

interface CalendarRow {
  id: string;
  name: string;
  all_day: boolean;
  starts_at: Date;
  ends_at: Date;
  time_zone: string;
  has_reminder: boolean;
  opportunity_id: string;
  number: string;
  title: string;
  assigned_admin_user_id: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Which of *Mine* and *All* a caller is offered, and which one is applied —
 * decided from the caller's reach and from nothing the client says alone
 * (`contracts/admin-api.md` §12d; FR-144; research N-CAL2).
 *
 * A caller who reaches every Organization is offered both and gets *All*
 * unless they ask for *Mine*. A caller confined to some Organizations — a
 * Sales Rep — is offered *Mine* only, and a request for *All* is answered as
 * *Mine*: not an error, so an address saved by somebody else keeps opening.
 */
export function calendarScopeFor(
  reach: OrgConstraint,
  asked: CalendarScope | undefined,
): { scope: CalendarScope; scopes: CalendarScope[] } {
  if (reach.kind !== 'all') return { scope: 'mine', scopes: ['mine'] };
  return { scope: asked ?? 'all', scopes: ['all', 'mine'] };
}

/**
 * The Calendar: the Events of active Opportunities over a range of at most 45
 * days (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12d;
 * FR-143 – FR-145, FR-151; research N-CAL3, N-CAL4, N-CAL11).
 *
 * **This is the one read in the module that does not start from a parent.**
 * An Event carries no tenant column, and here there is no Opportunity to load
 * through the scoped EntityManager first — so the statement joins
 * `crm_opportunities` and carries the caller's reach as a predicate on its
 * `organization_id`, built from `orgConstraintFor()` and from nothing else,
 * the form `analytics-service.ts` has for its own reads across Opportunities.
 * **There is no statement here over `crm_opportunity_events` without that
 * join**, and for a caller who reaches no Organization no statement runs.
 *
 * Three conditions always apply together: the reach; the Opportunity's status
 * being of kind `open` (so closing takes its Events off and reopening brings
 * them back, with no Event row written); and, under *Mine*, the Opportunity
 * being assigned to the caller **at the moment of asking** — an Event holds no
 * assignee, so reassigning moves every Event at once and there is nothing to
 * get out of step. A Sales Rep still named as assignee of an Opportunity whose
 * Organization they lost sees nothing of it: the reach is not the assignee's
 * to grant.
 *
 * Two reads whatever the number of Events or Opportunities: the statement, and
 * one call for the assignees' names.
 */
export class CalendarService {
  constructor(private readonly deps: CalendarServiceDeps) {}

  async list(query: CalendarEventsQuery): Promise<CalendarEventsResponse> {
    const reach = orgConstraintFor();
    const { scope, scopes } = calendarScopeFor(reach, query.scope);
    const meta = { scope, scopes, truncated: false };

    const predicate = analyticsScopePredicate(reach);
    // A reader who reaches no Organization: nothing is asked of the database.
    if (predicate === null) return { data: [], meta };
    const caller = actingAdminUserId();
    // "Mine" with nobody behind the request is nobody's.
    if (scope === 'mine' && caller === null) return { data: [], meta };

    const from = new Date(query.from);
    const to = new Date(query.to);
    // `ends_at > :from` alone cannot use the index on `starts_at`. An Event is
    // at most 25 hours long, so one that overlaps the range started no earlier
    // than 25 hours before it — which makes `starts_at` bounded on both sides.
    const earliestStart = new Date(from.getTime() - OPPORTUNITY_EVENT_MAX_SPAN_HOURS * HOUR_MS);

    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(
        `select e."id", e."name", e."all_day", e."starts_at", e."ends_at", e."time_zone",
                (e."remind_at" is not null) as "has_reminder",
                o."id" as "opportunity_id", o."number", o."title", o."assigned_admin_user_id"
           from "crm_opportunity_events" e
           join "crm_opportunities" o on o."id" = e."opportunity_id"
           join "crm_opportunity_statuses" s on s."code" = o."status_code" and s."kind" = 'open'
          where e."starts_at" < ? and e."starts_at" >= ? and e."ends_at" > ?${predicate.sql}${
            scope === 'mine' ? ' and o."assigned_admin_user_id" = ?' : ''
          }
          order by e."starts_at", e."id"
          limit ?`,
        [to, earliestStart, from, ...predicate.params, ...(scope === 'mine' ? [caller] : []), CALENDAR_EVENTS_MAX_RESULTS + 1],
      )) as CalendarRow[];

    const truncated = rows.length > CALENDAR_EVENTS_MAX_RESULTS;
    const page = truncated ? rows.slice(0, CALENDAR_EVENTS_MAX_RESULTS) : rows;

    const assigneeIds = [...new Set(page.map((row) => row.assigned_admin_user_id).filter((id): id is string => Boolean(id)))];
    const assignees = assigneeIds.length > 0 ? await this.deps.adminUsers.findByIds(assigneeIds) : [];
    const names = new Map(
      assignees.map((admin) => [admin.id, `${admin.firstName} ${admin.lastName}`.trim() || admin.email]),
    );

    const data: CalendarEvent[] = page.map((row) => {
      const startsAt = new Date(row.starts_at);
      const assigneeId = row.assigned_admin_user_id;
      return {
        id: row.id,
        name: row.name,
        allDay: row.all_day,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(row.ends_at).toISOString(),
        allDayDate: row.all_day ? allDayDateOf(startsAt, row.time_zone) : null,
        hasReminder: row.has_reminder,
        opportunity: {
          id: row.opportunity_id,
          number: row.number,
          title: row.title,
          assignee: assigneeId ? { id: assigneeId, name: names.get(assigneeId) ?? '' } : null,
        },
      };
    });
    return { data, meta: { ...meta, truncated } };
  }
}
