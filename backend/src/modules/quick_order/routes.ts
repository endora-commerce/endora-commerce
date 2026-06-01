import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
  quickOrderSearchQuerySchema,
} from '@b2b/contracts';
import { Product } from '../catalog/entities/product.entity.js';
import { ProductAttribute } from '../catalog/entities/product-attribute.entity.js';
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
    const ql = query.q.toLowerCase();

    // Quick search matches SKU, name, and values of `quick_searchable`
    // attributes only (FR-011 / FR-013). Name + attribute matching needs JSONB
    // text operators, so the candidate ids are resolved with knex, then loaded.
    const quickKeys = (
      await em.find(ProductAttribute, { quickSearchable: true }, { fields: ['key'] })
    ).map((a) => a.key);

    const knex = em.getKnex();
    const idRows = (await knex('products as p')
      .select('p.id')
      .where('p.status', 'active')
      .andWhere((b) => {
        void b
          .whereRaw('p.sku ILIKE ?', [needle])
          .orWhereRaw('p.slug ILIKE ?', [needle])
          .orWhereRaw('p.name::text ILIKE ?', [needle]);
        for (const key of quickKeys) {
          void b.orWhereRaw('p.attribute_values->>? ILIKE ?', [key, needle]);
        }
      })
      .orderBy('p.sku', 'asc')
      .limit(query.limit)) as Array<{ id: string }>;

    const ids = idRows.map((r) => r.id);
    if (ids.length === 0) return { data: [] };
    const products = await em.find(Product, { id: { $in: ids } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const matchedOnFor = (p: Product): Array<'sku' | 'name' | 'attribute'> => {
      const matched: Array<'sku' | 'name' | 'attribute'> = [];
      if (p.sku.toLowerCase().includes(ql)) matched.push('sku');
      if (Object.values(p.name).some((n) => String(n).toLowerCase().includes(ql))) {
        matched.push('name');
      }
      if (quickKeys.some((k) => String(p.attributeValues[k] ?? '').toLowerCase().includes(ql))) {
        matched.push('attribute');
      }
      return matched;
    };

    return {
      data: ids
        .map((id) => byId.get(id))
        .filter((p): p is Product => Boolean(p))
        .map((p) => ({
          productId: p.id,
          sku: p.sku,
          name: p.name['en-US'] ?? Object.values(p.name)[0] ?? p.sku,
          slug: p.slug,
          status: p.status,
          matchedOn: matchedOnFor(p),
        })),
    };
  });
}
