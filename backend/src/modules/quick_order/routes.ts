import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  quickOrderImportRequestSchema,
  quickOrderSearchQuerySchema,
} from '@b2b/contracts';
import { Product } from '../catalog/entities/product.entity.js';
import type { QuickOrderCsvImporter } from './services/csv-importer.js';

/**
 * Quick-order routes (T204 / FR-031).
 *   - POST /quick-order/import  parses CSV → recognised + rejected rows
 *   - GET  /quick-order/search  type-ahead by SKU prefix or name (active rows)
 *
 * Requires an authenticated customer session: the import doesn't
 * mutate the cart yet (the storefront drives the second step), but
 * SKU-to-product disclosure is gated to logged-in buyers per FR-009.
 */

export interface QuickOrderRoutesDeps {
  importer: QuickOrderCsvImporter;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
}

export async function registerQuickOrderRoutes(
  app: FastifyInstance,
  deps: QuickOrderRoutesDeps,
): Promise<void> {
  const { importer, emFactory, requireCustomer } = deps;

  app.post(
    '/api/v1/quick-order/import',
    { preHandler: requireCustomer, schema: { body: quickOrderImportRequestSchema } },
    async (request) => {
      const body = quickOrderImportRequestSchema.parse(request.body);
      // Interim: the legacy CSV path is preserved here; the file (.xlsx) +
      // build pipeline is wired in a follow-up task (feature 039 T019).
      const result = await importer.import(body.csv ?? '');
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
