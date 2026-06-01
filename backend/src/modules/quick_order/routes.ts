import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
  quickOrderSearchQuerySchema,
} from '@b2b/contracts';
import { Product } from '../catalog/entities/product.entity.js';
import type { QuickOrderImportPipeline } from './services/import-pipeline.js';
import type { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { parseImportRequest } from './services/import-from-request.js';

/**
 * Quick-order routes (feature 039).
 *   - POST /quick-order/import  parses CSV / .xlsx → recognised + rejected rows
 *   - POST /quick-order/build   recognised rows → Cart or Quote Request
 *   - GET  /quick-order/search  type-ahead by SKU prefix or name (active rows)
 *
 * Requires an authenticated customer session: SKU-to-product disclosure and
 * cart / RFQ mutation are gated to logged-in buyers.
 */

export interface QuickOrderRoutesDeps {
  pipeline: QuickOrderImportPipeline;
  buildService: QuickOrderBuildService;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Reads the `quick_order.import_max_rows` setting (falls back internally). */
  resolveImportMaxRows: () => Promise<number>;
}

export async function registerQuickOrderRoutes(
  app: FastifyInstance,
  deps: QuickOrderRoutesDeps,
): Promise<void> {
  const { pipeline, buildService, emFactory, requireCustomer, resolveCustomerContext } = deps;

  app.post(
    '/api/v1/quick-order/import',
    { preHandler: requireCustomer, schema: { body: quickOrderImportRequestSchema } },
    async (request) => {
      const body = quickOrderImportRequestSchema.parse(request.body);
      const maxRows = await deps.resolveImportMaxRows();
      const parse = await parseImportRequest(body);
      const result = await pipeline.run(parse, { maxRows });
      return { data: result };
    },
  );

  app.post(
    '/api/v1/quick-order/build',
    { preHandler: requireCustomer, schema: { body: quickOrderBuildRequestSchema } },
    async (request) => {
      const body = quickOrderBuildRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      const result = await buildService.build(
        { customerAccountId: ctx.customerAccountId, organizationId: ctx.organizationId },
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

  app.get('/api/v1/quick-order/search', { preHandler: requireCustomer }, async (request) => {
    const query = quickOrderSearchQuerySchema.parse(request.query ?? {});
    const em = emFactory();
    const needle = `%${query.q}%`;
    // SKU + slug ILIKE is enough for MVP type-ahead; Meilisearch covers
    // full-text matches against the multilingual name JSONB blob.
    const rows = await em.find(
      Product,
      {
        status: 'active',
        $or: [{ sku: { $ilike: needle } }, { slug: { $ilike: needle } }],
      },
      { limit: query.limit, orderBy: { sku: 'asc' } },
    );
    return {
      data: rows.map((p) => ({
        productId: p.id,
        sku: p.sku,
        name: p.name['en-US'] ?? Object.values(p.name)[0] ?? p.sku,
        slug: p.slug,
        status: p.status,
      })),
    };
  });
}
