import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
  quickOrderSearchQuerySchema,
  type CatalogAttributeReadPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
} from '@b2b/contracts';
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
  /**
   * Feature 061 — the catalog's composed attribute read model. Replaces the
   * former direct `ProductAttribute` entity find (Principle I): quick-search
   * sources its `quick_searchable` keys through this injected port.
   */
  catalogAttributeRead: CatalogAttributeReadPort;
  /** `catalog`'s product read model — the rows the search ids resolve to. */
  catalogProducts: CatalogProductReadPort;
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
    const quickKeys = (await deps.catalogAttributeRead.listByFlag('quickSearchable')).map(
      (a) => a.key,
    );

    // ---------------------------------------------------------------------
    // A cross-module read `check:module-boundary` is structurally unable to
    // see (feature 075, plan.md trap 6). `products` is `catalog`'s table, and
    // this is a hand-written `select` against it — no import specifier, so no
    // ledger entry can key it and the shard reads clean either way.
    //
    // It is left standing rather than "fixed" here, deliberately. Inlining is
    // what trap 6 forbids and this predates the sweep; the remedy is a
    // published quick-search port on `catalog`, because the predicate is a
    // catalogue question — `status = 'active'`, `sku`/`slug`/`name` ILIKE and
    // a lookup into `attribute_values` keyed by the `quickSearchable`
    // attributes — and `CatalogProductReadPort` has no text search. Publishing
    // one is a Phase-P change on `catalog`, not a consumer's cut.
    //
    // Two facts to carry into that MR. The query filters neither `visibility`
    // nor `allowed_organization_ids` nor sales-channel membership, so a
    // signed-in buyer's type-ahead sees every active product on the platform
    // whatever channel they are shopping (Principle XII); and the JSONB reach
    // into `attribute_values` is `catalog`'s storage layout, so a column
    // rename in `catalog` breaks this file with nothing to warn either side.
    // ---------------------------------------------------------------------
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
    const products = await deps.catalogProducts.findByIds(ids);
    const byId = new Map(products.map((p) => [p.id, p]));

    const matchedOnFor = (p: CatalogProductRecord): Array<'sku' | 'name' | 'attribute'> => {
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
        .filter((p): p is CatalogProductRecord => Boolean(p))
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
