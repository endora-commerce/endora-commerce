import type { FastifyInstance } from 'fastify';
import {
  CalendarEventsQuerySchema,
  CreateOpportunityEventRequestSchema,
  UpdateOpportunityEventRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { CalendarService } from '../services/calendar-service.js';
import type { OpportunityEventService } from '../services/opportunity-event-service.js';

export interface EventRoutesDeps {
  eventService: OpportunityEventService;
  calendarService: CalendarService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Events on an Opportunity and the Calendar
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12d).
 *
 * `crm:write` plus the reach to the Opportunity lets somebody add, edit and
 * delete **any** of its Events — an Event is the Opportunity's plan, not its
 * author's property (FR-132), so unlike a note there is no author test behind
 * these gates.
 *
 * The Calendar is a read on `crm:read` and has no 404: it only ever answers
 * what the caller may see. Which of *Mine* and *All* is applied is the
 * service's decision, from the caller's reach.
 */
export async function registerCrmEventRoutes(app: FastifyInstance, deps: EventRoutesDeps): Promise<void> {
  const { requireAdmin, eventService: events, calendarService: calendar } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/events',
    { preHandler: requireAdmin('crm:read') },
    async (request) => ({ data: await events.list(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/crm/opportunities/:id/events',
    { preHandler: requireAdmin('crm:write'), schema: { body: CreateOpportunityEventRequestSchema } },
    async (request, reply) => {
      const event = await events.add(request.params.id, CreateOpportunityEventRequestSchema.parse(request.body));
      reply.code(201);
      return { data: event };
    },
  );

  app.patch<{ Params: { id: string; eventId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/events/:eventId',
    { preHandler: requireAdmin('crm:write'), schema: { body: UpdateOpportunityEventRequestSchema } },
    async (request) => ({
      data: await events.update(
        request.params.id,
        request.params.eventId,
        UpdateOpportunityEventRequestSchema.parse(request.body),
      ),
    }),
  );

  app.delete<{ Params: { id: string; eventId: string } }>(
    '/api/v1/admin/crm/opportunities/:id/events/:eventId',
    { preHandler: requireAdmin('crm:write') },
    async (request, reply) => {
      await events.remove(request.params.id, request.params.eventId);
      return reply.code(204).send();
    },
  );

  app.get(
    '/api/v1/admin/crm/calendar/events',
    { preHandler: requireAdmin('crm:read') },
    async (request) => calendar.list(CalendarEventsQuerySchema.parse(request.query ?? {})),
  );
}
