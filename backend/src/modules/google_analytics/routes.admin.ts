import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  gaCustomEventCreateSchema,
  gaCustomEventUpdateSchema,
  gaCustomEventListQuerySchema,
  GA_ACTION_FIELD_CATALOGUE,
} from '@endora-commerce/contracts';
import type { GaCustomEventsService, GaAuditContext } from './services/custom-events.service.js';

export interface GoogleAnalyticsAdminDeps {
  customEvents: GaCustomEventsService;
  requireAdmin: (permission?: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveAuditContext: (req: FastifyRequest) => GaAuditContext;
}

/**
 * Admin routes for the Google Analytics module (feature 049, US3). Custom-event
 * CRUD + the static action-field catalogue that drives the admin field picker.
 * Per-channel Settings (Measurement ID, Enhanced Ecommerce, server-side) are
 * managed through the generic Settings admin surface, not here.
 */
export async function registerGoogleAnalyticsAdminRoutes(
  app: FastifyInstance,
  deps: GoogleAnalyticsAdminDeps,
): Promise<void> {
  const { customEvents, requireAdmin, resolveAuditContext } = deps;

  app.get(
    '/api/v1/admin/google-analytics/action-catalogue',
    { preHandler: requireAdmin('google_analytics:read') },
    async () => ({ data: GA_ACTION_FIELD_CATALOGUE }),
  );

  app.get(
    '/api/v1/admin/google-analytics/custom-events',
    { preHandler: requireAdmin('google_analytics:read') },
    async (request) => {
      const query = gaCustomEventListQuerySchema.parse(request.query);
      const items = await customEvents.list(query);
      return { data: items };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/google-analytics/custom-events/:id',
    { preHandler: requireAdmin('google_analytics:read') },
    async (request) => {
      const item = await customEvents.get(request.params.id);
      return { data: item };
    },
  );

  app.post(
    '/api/v1/admin/google-analytics/custom-events',
    { preHandler: requireAdmin('google_analytics:write') },
    async (request, reply) => {
      const body = gaCustomEventCreateSchema.parse(request.body);
      const item = await customEvents.create(body, resolveAuditContext(request));
      return reply.status(201).send({ data: item });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/google-analytics/custom-events/:id',
    { preHandler: requireAdmin('google_analytics:write') },
    async (request) => {
      const body = gaCustomEventUpdateSchema.parse(request.body);
      const item = await customEvents.update(request.params.id, body, resolveAuditContext(request));
      return { data: item };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/google-analytics/custom-events/:id',
    { preHandler: requireAdmin('google_analytics:write') },
    async (request, reply) => {
      await customEvents.remove(request.params.id, resolveAuditContext(request));
      return reply.status(204).send();
    },
  );
}
