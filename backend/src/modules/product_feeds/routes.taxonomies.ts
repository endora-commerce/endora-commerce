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
import type { TaxonomyRevisionService } from './services/taxonomy-revision.service.js';

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
 *   GET /api/v1/admin/feed-taxonomies/revisions
 *   GET /api/v1/admin/feed-taxonomies/revisions/:taxonomyId/impact
 *  POST /api/v1/admin/feed-taxonomies/revisions/:taxonomyId/promote
 *   GET /api/v1/admin/feed-taxonomies/checks
 *  POST /api/v1/admin/feed-taxonomies/checks
 *
 * A **sibling** namespace, not a child of `/product-feeds`, which is parametric
 * on `:feedId` — mappings are installation-wide, and nesting them under a feed
 * id would advertise a per-feed scope that FR-081 explicitly does not have.
 *
 * **There is deliberately no route that uploads a taxonomy file, and none that
 * installs a revision as current in one step.** Installation and activation are
 * separate by design (FR-086): a revision arrives either bundled with the
 * platform or from an optional, off-by-default check, and in both cases only
 * `POST /revisions/:id/promote` — an audited operator Command — changes what a
 * feed emits. `GET /revisions/:id/impact` writes nothing, which is what lets
 * the admin make promotion physically unreachable without reading the
 * consequences first.
 */

export interface ProductFeedsTaxonomyRoutesDeps {
  requireAdmin: RequireAdminFactory;
  mappings: TaxonomyMappingService;
  /** The revisions surface (FR-078, FR-094 – FR-096). */
  revisions: TaxonomyRevisionService;
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

const languageQuerySchema = z.object({
  lang: z.string().min(2).max(12).optional(),
});

const taxonomyIdParamsSchema = z.object({ taxonomyId: z.string().uuid() });

const checkListQuerySchema = providerQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const promoteBodySchema = z.object({
  /** The figure the impact preview showed — a mismatch is `409` (FR-095). */
  expectedStaleMappingCount: z.number().int().nonnegative(),
});

const startCheckBodySchema = z.object({
  providerCode: taxonomyProviderCodeSchema,
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

  // -------------------------------------------------------------------------
  // Revision refresh (FR-078, FR-094 – FR-096)
  // -------------------------------------------------------------------------

  app.get('/api/v1/admin/feed-taxonomies/revisions', read, async (request, reply) => {
    const query = parseOrThrow(providerQuerySchema, request.query ?? {});
    const rows = await deps.revisions.listRevisions(query.providerCode);
    return reply.send({
      data: rows,
      pagination: { cursor: null, hasMore: false, limit: rows.length },
    });
  });

  app.get(
    '/api/v1/admin/feed-taxonomies/revisions/:taxonomyId/impact',
    read,
    async (request, reply) => {
      const params = parseOrThrow(taxonomyIdParamsSchema, request.params ?? {});
      const query = parseOrThrow(languageQuerySchema, request.query ?? {});
      // Read-only, by construction: `impact()` loads and computes, and there is
      // no write path from here (FR-094).
      const impact = await deps.revisions.impact(
        params.taxonomyId,
        query.lang ?? fallbackLanguage,
      );
      return reply.send({ data: impact });
    },
  );

  app.post(
    '/api/v1/admin/feed-taxonomies/revisions/:taxonomyId/promote',
    write,
    async (request, reply) => {
      const params = parseOrThrow(taxonomyIdParamsSchema, request.params ?? {});
      const body = parseOrThrow(promoteBodySchema, request.body ?? {});
      const result = await deps.revisions.promote({
        taxonomyId: params.taxonomyId,
        expectedStaleMappingCount: body.expectedStaleMappingCount,
      });
      const rows = await deps.revisions.listRevisions(result.providerCode);
      const promoted = rows.find((row) => row.id === result.taxonomyId);
      return reply.send({ data: promoted ?? null });
    },
  );

  app.get('/api/v1/admin/feed-taxonomies/checks', read, async (request, reply) => {
    const query = parseOrThrow(checkListQuerySchema, request.query ?? {});
    const rows = await deps.revisions.listChecks(query.providerCode, query.limit);
    return reply.send({
      data: rows,
      pagination: { cursor: null, hasMore: false, limit: rows.length },
    });
  });

  app.post('/api/v1/admin/feed-taxonomies/checks', write, async (request, reply) => {
    const body = parseOrThrow(startCheckBodySchema, request.body ?? {});
    const check = await deps.revisions.startCheck(body.providerCode);
    // 202: the row is the receipt and the work belongs to the worker, exactly
    // as a manual generation run answers.
    return reply.code(202).send({ data: check });
  });
}

/** Re-exported so the admin surface and the tests share one localization rule. */
export { localized };
