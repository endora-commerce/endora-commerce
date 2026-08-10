import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { QuickOrderImportPipeline } from './services/import-pipeline.js';
import type { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { parseImportRequest } from './services/import-from-request.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin quick-order routes (feature 039, FR-008). An operator imports a file
 * and builds a Cart / Quote Request on behalf of a specific customer +
 * organization (`onBehalfOf`), priced under that organization's price list.
 * Guarded by the `orders:write` permission.
 */
export interface QuickOrderAdminRoutesDeps {
  pipeline: QuickOrderImportPipeline;
  buildService: QuickOrderBuildService;
  requireAdmin: RequireAdminFactory;
  resolveImportMaxRows: () => Promise<number>;
}

export async function registerQuickOrderAdminRoutes(
  app: FastifyInstance,
  deps: QuickOrderAdminRoutesDeps,
): Promise<void> {
  const { pipeline, buildService, requireAdmin, resolveImportMaxRows } = deps;

  app.post(
    '/api/v1/admin/quick-order/import',
    { preHandler: requireAdmin('orders:write'), schema: { body: quickOrderImportRequestSchema } },
    async (request) => {
      const body = quickOrderImportRequestSchema.parse(request.body);
      const maxRows = await resolveImportMaxRows();
      const parse = await parseImportRequest(body);
      const result = await pipeline.run(parse, { maxRows });
      return { data: result };
    },
  );

  app.post(
    '/api/v1/admin/quick-order/build',
    { preHandler: requireAdmin('orders:write'), schema: { body: quickOrderBuildRequestSchema } },
    async (request) => {
      const body = quickOrderBuildRequestSchema.parse(request.body);
      if (!body.onBehalfOf) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'onBehalfOf is required for an admin quick-order build.',
        );
      }
      const result = await buildService.build(
        {
          customerAccountId: body.onBehalfOf.customerAccountId,
          organizationId: body.onBehalfOf.organizationId,
          isOrgAdmin: false,
        },
        {
          target: body.target,
          items: body.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          })),
        },
      );
      return { data: result };
    },
  );
}
