import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RecentActivityService } from './services/recent-activity-service.js';
import { RECENT_ACTIVITY_ACTIONS } from './action-catalog.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Feature 024 — `GET /api/v1/admin/audit-log/recent-activity`.
 *
 * Curated read view over `audit_log_entries` that powers the admin home
 * dashboard's Recent Activity card. Filters server-side to a fixed
 * allowlist of action tokens (Catalog / Inventory / Price Lists),
 * enriches actor + target display labels, and caps the result at 12 rows.
 *
 * Permission: same `audit_log:read` scope used by the wider audit-log
 * read endpoint (`GET /api/v1/admin/audit-log`).
 */

export interface RecentActivityAdminDeps {
  recentActivityService: RecentActivityService;
  requireAdmin: RequireAdminFactory;
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

const itemSchema = z.object({
  id: z.string().uuid(),
  actedAt: z.string(),
  action: z.enum(RECENT_ACTIVITY_ACTIONS as unknown as [string, ...string[]]),
  module: z.enum(['catalog', 'inventory', 'price_lists']),
  actorDisplayName: z.string().min(1),
  actorKind: z.enum(['admin', 'system']),
  targetType: z.string().min(1),
  targetId: z.string().min(1),
  targetDisplayName: z.string().min(1),
  targetUrl: z.string().nullable(),
  summary: z.record(z.string(), z.unknown()).nullable(),
});

const responseSchema = z.object({
  data: z.array(itemSchema),
  pagination: z.object({
    limit: z.number().int().min(1).max(12),
    fetchedAt: z.string(),
  }),
});

export type RecentActivityRouteResponse = z.infer<typeof responseSchema>;

export async function registerRecentActivityRoutes(
  app: FastifyInstance,
  deps: RecentActivityAdminDeps,
): Promise<void> {
  const { recentActivityService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/audit-log/recent-activity',
    { preHandler: requireAdmin('audit_log:read') },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'validation_error',
            message: 'Invalid query parameters',
            details: parsed.error.flatten(),
          },
        });
      }
      const input: { limit?: number } = {};
      if (parsed.data.limit !== undefined) input.limit = parsed.data.limit;
      return recentActivityService.list(input);
    },
  );
}
