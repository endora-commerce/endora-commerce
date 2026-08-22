import type { FastifyInstance } from 'fastify';
import {
  analyticsSummaryQuerySchema,
  ingestAnalyticsBatchRequestSchema,
} from '@endora-commerce/contracts';
import type { AnalyticsIngestService } from './services/analytics-ingest.service.js';
import type { AnalyticsQueryService } from './services/analytics-query.service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface AnalyticsRoutesDeps {
  ingestService: AnalyticsIngestService;
  queryService: AnalyticsQueryService;
  requireAdmin: RequireAdminFactory;
}

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  deps: AnalyticsRoutesDeps,
): Promise<void> {
  const { ingestService, queryService, requireAdmin } = deps;

  // Public ingest — accepts batches from storefront + admin. No auth gate by
  // design (FR-110): we want anonymous browsing events, and the rate limiter
  // already protects against floods.
  app.post(
    '/api/v1/analytics/events',
    { schema: { body: ingestAnalyticsBatchRequestSchema } },
    async (request, reply) => {
      const body = ingestAnalyticsBatchRequestSchema.parse(request.body);
      const result = await ingestService.ingest({
        events: body.events,
        requestId: request.id,
      });
      reply.status(202);
      return { data: result };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string; salesChannelId?: string } }>(
    '/api/v1/admin/analytics/summary',
    { preHandler: requireAdmin('analytics:read') },
    async (request) => {
      const query = analyticsSummaryQuerySchema.parse(request.query);
      const summary = await queryService.summary(query);
      return { data: summary };
    },
  );
}
