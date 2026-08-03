import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taxonomyProviderCodeSchema } from '@b2b/contracts';
import { PRODUCT_FEEDS_READ_PERMISSION, PRODUCT_FEEDS_WRITE_PERMISSION } from './manifest.js';
import type { RequireAdminFactory } from './routes.admin.js';
import { parseOrThrow } from './routes.admin.js';
import {
  localized,
  type TaxonomyMappingService,
} from './services/taxonomy-mapping.service.js';
import { resolveEffectiveMapping } from './services/taxonomy-mapping-resolver.js';

/**
 * Provider taxonomies and category mappings — feature 067
 * (contracts/admin-taxonomy-mappings.md §1).
 *
 *   GET /api/v1/admin/feed-taxonomies
 *   GET /api/v1/admin/feed-taxonomies/nodes
 *   GET /api/v1/admin/feed-taxonomies/mappings
 *   PUT /api/v1/admin/feed-taxonomies/mappings
 *   GET /api/v1/admin/feed-taxonomies/coverage
 *   GET /api/v1/admin/feed-taxonomies/stale-mappings
 *
 * A **sibling** namespace, not a child of `/product-feeds`, which is parametric
 * on `:feedId` — mappings are installation-wide, and nesting them under a feed
 * id would advertise a per-feed scope that FR-081 explicitly does not have.
 *
 * **There is deliberately no install, upload or refresh route.** Taxonomies
 * ship as reference data inside the module and are loaded by the lifecycle
 * reconciler; a runtime fetch is forbidden by FR-077 because it would make feed
 * output depend on a third party's uptime and break air-gapped installations.
 */

export interface ProductFeedsTaxonomyRoutesDeps {
  requireAdmin: RequireAdminFactory;
  mappings: TaxonomyMappingService;
  /** Falls back to `en` when the request does not name one. */
  defaultLanguage?: string;
}

const providerQuerySchema = z.object({
  providerCode: taxonomyProviderCodeSchema,
  lang: z.string().min(2).max(12).optional(),
});

const nodeSearchQuerySchema = providerQuerySchema.extend({
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const mappingListQuerySchema = providerQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(1000).default(200),
  offset: z.coerce.number().int().nonnegative().optional(),
});

const setMappingBodySchema = z.object({
  providerCode: taxonomyProviderCodeSchema,
  categoryId: z.string().uuid(),
  /** Null clears the explicit mapping so the category inherits again. */
  nodeExternalId: z.string().max(32).nullable(),
});

export async function registerProductFeedsTaxonomyRoutes(
  app: FastifyInstance,
  deps: ProductFeedsTaxonomyRoutesDeps,
): Promise<void> {
  const read = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_READ_PERMISSION) };
  const write = { preHandler: deps.requireAdmin(PRODUCT_FEEDS_WRITE_PERMISSION) };
  const fallbackLanguage = deps.defaultLanguage ?? 'en';

  app.get('/api/v1/admin/feed-taxonomies', read, async (_request, reply) => {
    const installed = await deps.mappings.listInstalled();
    return reply.send({
      data: installed.map((taxonomy) => ({
        providerCode: taxonomy.providerCode,
        revision: taxonomy.revision,
        nodeCount: taxonomy.nodeCount,
        installedAt: taxonomy.installedAt.toISOString(),
      })),
    });
  });

  app.get('/api/v1/admin/feed-taxonomies/nodes', read, async (request, reply) => {
    const query = parseOrThrow(nodeSearchQuerySchema, request.query ?? {});
    const rows = await deps.mappings.searchNodes({
      providerCode: query.providerCode,
      ...(query.q !== undefined ? { query: query.q } : {}),
      language: query.lang ?? fallbackLanguage,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
    return reply.send({ data: rows });
  });

  app.get('/api/v1/admin/feed-taxonomies/mappings', read, async (request, reply) => {
    const query = parseOrThrow(mappingListQuerySchema, request.query ?? {});
    const { rows, total } = await deps.mappings.listMappings({
      providerCode: query.providerCode,
      language: query.lang ?? fallbackLanguage,
      limit: query.limit,
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
    });
    return reply.send({
      data: rows,
      pagination: {
        cursor: null,
        hasMore: (query.offset ?? 0) + rows.length < total,
        limit: query.limit,
      },
    });
  });

  app.put('/api/v1/admin/feed-taxonomies/mappings', write, async (request, reply) => {
    const body = parseOrThrow(setMappingBodySchema, request.body ?? {});
    await deps.mappings.setMapping(body);

    // Answer with the category's EFFECTIVE row, not with what was written:
    // clearing an explicit mapping leaves an inherited value, and the operator
    // needs to see the value that will actually be used.
    const language =
      (request.query as { lang?: string } | undefined)?.lang ?? fallbackLanguage;
    const context = await deps.mappings.resolutionContext(body.providerCode);
    const effective = resolveEffectiveMapping(
      body.categoryId,
      context.categoriesById,
      context.mappingsByCategoryId,
    );
    const nodes = await deps.mappings.searchNodes({
      providerCode: body.providerCode,
      language,
      limit: 200,
    });
    const node = effective.nodeExternalId
      ? nodes.find((n) => n.externalId === effective.nodeExternalId)
      : undefined;

    return reply.send({
      data: {
        ...effective,
        nodeFullPath: node ? node.fullPath : null,
      },
    });
  });

  app.get('/api/v1/admin/feed-taxonomies/coverage', read, async (request, reply) => {
    const query = parseOrThrow(providerQuerySchema, request.query ?? {});
    const coverage = await deps.mappings.coverage(query.providerCode);
    return reply.send({
      data:
        coverage ?? {
          providerCode: query.providerCode,
          revision: '',
          totalCategories: 0,
          explicitlyMapped: 0,
          coveredByInheritance: 0,
          uncovered: 0,
          staleMappings: 0,
        },
    });
  });

  app.get('/api/v1/admin/feed-taxonomies/stale-mappings', read, async (request, reply) => {
    const query = parseOrThrow(providerQuerySchema, request.query ?? {});
    const rows = await deps.mappings.listStale(
      query.providerCode,
      query.lang ?? fallbackLanguage,
    );
    return reply.send({
      data: rows,
      pagination: { cursor: null, hasMore: false, limit: rows.length },
    });
  });
}

/** Re-exported so the admin surface and the tests share one localization rule. */
export { localized };
