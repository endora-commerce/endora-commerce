import type { FastifyInstance } from 'fastify';
import {
  OpportunityAnalyticsQuerySchema,
  OpportunityTimeInStatusQuerySchema,
  TopOpportunitiesQuerySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { AnalyticsService } from '../services/analytics-service.js';

export interface AnalyticsRoutesDeps {
  analyticsService: AnalyticsService;
  requireAdmin: RequireAdminFactory;
}

/**
 * Analytics (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §12).
 *
 * Five reads, each gated `crm:analytics` — a code of its own, because how the
 * whole team is doing is not what everybody who works an Opportunity is shown.
 * Each takes a range of days and may be narrowed to a Sales Channel and to an
 * assignee; tenant scope is ambient, so a confined manager's figures are over
 * their Organizations.
 */
export async function registerCrmAnalyticsRoutes(
  app: FastifyInstance,
  deps: AnalyticsRoutesDeps,
): Promise<void> {
  const { requireAdmin, analyticsService: analytics } = deps;

  app.get(
    '/api/v1/admin/crm/analytics/handling-time',
    { preHandler: requireAdmin('crm:analytics') },
    async (request) => ({
      data: await analytics.handlingTime(OpportunityAnalyticsQuerySchema.parse(request.query ?? {})),
    }),
  );

  app.get(
    '/api/v1/admin/crm/analytics/time-in-status',
    { preHandler: requireAdmin('crm:analytics') },
    async (request) => ({
      data: await analytics.timeInStatus(OpportunityTimeInStatusQuerySchema.parse(request.query ?? {})),
    }),
  );

  app.get(
    '/api/v1/admin/crm/analytics/rep-effectiveness',
    { preHandler: requireAdmin('crm:analytics') },
    async (request) => ({
      data: await analytics.repEffectiveness(OpportunityAnalyticsQuerySchema.parse(request.query ?? {})),
    }),
  );

  app.get(
    '/api/v1/admin/crm/analytics/top-opportunities',
    { preHandler: requireAdmin('crm:analytics') },
    async (request) => ({
      data: await analytics.topOpportunities(TopOpportunitiesQuerySchema.parse(request.query ?? {})),
    }),
  );

  app.get(
    '/api/v1/admin/crm/analytics/average-value',
    { preHandler: requireAdmin('crm:analytics') },
    async (request) => ({
      data: await analytics.averageValue(OpportunityAnalyticsQuerySchema.parse(request.query ?? {})),
    }),
  );
}
