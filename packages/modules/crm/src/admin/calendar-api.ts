import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  CalendarEventsResponseSchema,
  OpportunityEventListResponseSchema,
  OpportunityEventResponseSchema,
  type CalendarEventsResponse,
  type CalendarScope,
  type CreateOpportunityEventRequest,
  type OpportunityEvent,
  type UpdateOpportunityEventRequest,
} from '@endora-commerce/contracts';

/**
 * The five calls of Events and the Calendar
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12d).
 *
 * A file of its own beside `api.ts`, as analytics has: the Events tab and the
 * Calendar page are the only callers.
 *
 * **Every answer is parsed with the contract's own schema**, not merely typed
 * by it. The two tracks of this story were built apart, against that contract;
 * a route that answers something else is then a failed read with a schema's
 * message in the console on the first visit, rather than a calendar quietly
 * drawing `Invalid Date`.
 */

const BASE = '/api/v1/admin/crm';

const eventsPath = (opportunityId: string): string =>
  `${BASE}/opportunities/${encodeURIComponent(opportunityId)}/events`;

export interface CalendarEventsParams {
  /** Inclusive. */
  from: Date;
  /** Exclusive; at most 45 days after `from`. */
  to: Date;
  /** Absent = the caller's default; the server says which it applied. */
  scope?: CalendarScope | null;
}

export const crmCalendarApi = {
  /** Every Event of one Opportunity, by start. `crm:read`. */
  async listEvents(opportunityId: string): Promise<OpportunityEvent[]> {
    return OpportunityEventListResponseSchema.parse(await apiClient.get(eventsPath(opportunityId))).data;
  },

  /** `crm:write`. A refused rule is a 422 with `details.field` and `details.rule`. */
  async createEvent(opportunityId: string, body: CreateOpportunityEventRequest): Promise<OpportunityEvent> {
    return OpportunityEventResponseSchema.parse(await apiClient.post(eventsPath(opportunityId), body)).data;
  },

  /** `crm:write`. Only the members named are changed; `remindAt: null` removes the reminder. */
  async updateEvent(
    opportunityId: string,
    eventId: string,
    body: UpdateOpportunityEventRequest,
  ): Promise<OpportunityEvent> {
    return OpportunityEventResponseSchema.parse(
      await apiClient.patch(`${eventsPath(opportunityId)}/${encodeURIComponent(eventId)}`, body),
    ).data;
  },

  /** `crm:write`. 204. */
  async deleteEvent(opportunityId: string, eventId: string): Promise<void> {
    await apiClient.delete(`${eventsPath(opportunityId)}/${encodeURIComponent(eventId)}`);
  },

  /**
   * The Events that overlap a range, of the active Opportunities the caller may
   * see. `crm:read`.
   *
   * The instants go out in UTC (`toISOString`): the `+` of an offset in a query
   * string arrives as a space unless it is percent-encoded, and `Z` has none.
   */
  async calendarEvents(params: CalendarEventsParams): Promise<CalendarEventsResponse> {
    const query = new URLSearchParams({
      from: params.from.toISOString(),
      to: params.to.toISOString(),
    });
    if (params.scope) query.set('scope', params.scope);
    return CalendarEventsResponseSchema.parse(
      await apiClient.get(`${BASE}/calendar/events?${query.toString()}`),
    );
  },
};
