import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  GetAdminActionsQuerySchema,
  GetAdminActionsResponseSchema,
  type GetAdminActionsResponse,
} from '@b2b/contracts';
import type { AdminActionsService } from './services/admin-actions-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export interface AdminActionsRouteDeps {
  adminActionsService: AdminActionsService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

/**
 * GET /api/v1/admin/admin-actions?language=…
 *
 * Returns the operator-visible action list for the requested language
 * — already filtered by enabled-module + permission, already resolved
 * to localized labels, already sorted by `(weight, label)`.
 */
export async function registerAdminActionsRoutes(
  app: FastifyInstance,
  deps: AdminActionsRouteDeps,
): Promise<void> {
  app.get(
    '/api/v1/admin/admin-actions',
    {
      preHandler: deps.requireAdmin(),
      schema: { querystring: GetAdminActionsQuerySchema },
    },
    async (request, reply): Promise<{ data: GetAdminActionsResponse }> => {
      const { language } = GetAdminActionsQuerySchema.parse(request.query);
      const ctx = deps.resolveAdminContext(request);
      const result = await deps.adminActionsService.listVisibleForOperator({
        language,
        adminUserId: ctx.adminUserId,
      });
      const payload: GetAdminActionsResponse = {
        data: result.actions,
        meta: {
          language,
          total: result.actions.length,
          registryVersion: result.registryVersion,
        },
      };
      reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
      return { data: GetAdminActionsResponseSchema.parse(payload) };
    },
  );
}
