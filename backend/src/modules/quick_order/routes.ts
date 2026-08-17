import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
  quickOrderSearchQuerySchema,
  type CatalogQuickSearchPort,
} from '@b2b/contracts';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { QuickOrderImportPipeline } from './services/import-pipeline.js';
import type { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { parseImportRequest } from './services/import-from-request.js';

/**
 * Quick-order routes (feature 039).
 *   - POST /quick-order/import  parses CSV / .xlsx → recognised + rejected rows
 *   - POST /quick-order/build   recognised rows → Cart or Quote Request
 *   - GET  /quick-order/search  type-ahead over the catalogue, in the channel
 *     the request resolved
 *
 * Requires an authenticated customer session: SKU-to-product disclosure and
 * cart / RFQ mutation are gated to logged-in buyers.
 */

export interface QuickOrderRoutesDeps {
  pipeline: QuickOrderImportPipeline;
  buildService: QuickOrderBuildService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Reads the `quick_order.import_max_rows` setting (falls back internally). */
  resolveImportMaxRows: () => Promise<number>;
  /**
   * `catalog`'s channel-scoped type-ahead (issue #174). It replaces three
   * things at once: the `emFactory` this file used to open a knex query with,
   * the attribute read it used to source `quickSearchable` keys from, and the
   * product read it used to hydrate the ids that query returned. The predicate
   * and the `matchedOn` labels belong to the module that owns the tables.
   */
  catalogQuickSearch: CatalogQuickSearchPort;
}

export async function registerQuickOrderRoutes(
  app: FastifyInstance,
  deps: QuickOrderRoutesDeps,
): Promise<void> {
  const { pipeline, buildService, requireCustomer, resolveCustomerContext } = deps;

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

    /**
     * Issue #174 — the type-ahead asks `catalog`, and asks it *in a channel*.
     *
     * This used to be a hand-written knex `select` against `catalog`'s
     * `products` table, reaching into its `attribute_values` JSONB and
     * filtering on `status = 'active'` and nothing else. Two costs. The edge
     * had no import specifier, so `check:module-boundary` could not see it and
     * no ledger shard could key it — trap 6's "strictly worse than an import".
     * And with no channel predicate, a signed-in buyer's type-ahead returned
     * every active product on the platform, whichever channel they were
     * shopping: Constitution XII, in the one place no static check was looking.
     *
     * `catalogQuickSearchPort` owns the predicate now, including which
     * attributes are `quickSearchable` and which `matchedOn` labels a hit
     * carries — both are facts about `catalog`'s own tables. What is left here
     * is the buyer's language pick, which is this surface's business.
     *
     * The channel is the one the canonical resolver already put on the request
     * scope (feature 053 / Constitution XII), never re-resolved from a header
     * here.
     */
    const hits = await deps.catalogQuickSearch.quickSearch({
      q: query.q,
      limit: query.limit,
      salesChannelId: getResolvedChannel(request).id,
    });

    return {
      data: hits.map((hit) => ({
        productId: hit.productId,
        sku: hit.sku,
        name: hit.name['en-US'] ?? Object.values(hit.name)[0] ?? hit.sku,
        slug: hit.slug,
        status: hit.status,
        matchedOn: hit.matchedOn,
      })),
    };
  });
}
