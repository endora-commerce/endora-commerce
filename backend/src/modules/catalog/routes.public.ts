import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CatalogQueryService } from './services/catalog-query.service.js';

/**
 * Public catalog routes (US1 read surface).
 * Storefront SSR + crawlers + anonymous API consumers. No auth.
 */

const salesChannelHeaderSchema = z.string().optional();
const acceptLanguageHeaderSchema = z.string().optional();

export interface CatalogPublicDeps {
  queryService: CatalogQueryService;
}

export async function registerCatalogPublicRoutes(
  app: FastifyInstance,
  deps: CatalogPublicDeps,
): Promise<void> {
  const { queryService } = deps;

  // GET /api/v1/catalog/products
  app.get('/api/v1/catalog/products', async (request, reply) => {
    const { q, limit, cursor, sort, categorySlug, attributeFilters, changedSince } =
      parseListQuery(request);
    const ctx = readContext(request);
    try {
      const result = await queryService.listProducts(
        { q, limit, cursor, sort, categorySlug, attributeFilters, changedSince },
        ctx,
      );
      reply.header('x-search-backend', 'postgres');
      return result;
    } catch (err) {
      throw err;
    }
  });

  // GET /api/v1/catalog/products/:idOrSlug
  app.get<{ Params: { idOrSlug: string } }>(
    '/api/v1/catalog/products/:idOrSlug',
    async (request) => {
      const ctx = readContext(request);
      const product = await queryService.getProductByIdOrSlug(request.params.idOrSlug, ctx);
      return { data: product };
    },
  );

  // GET /api/v1/catalog/categories
  app.get('/api/v1/catalog/categories', async (request) => {
    const ctx = readContext(request);
    const tree = await queryService.getCategoryTree(ctx);
    return { data: tree };
  });

  // GET /api/v1/catalog/filters
  app.get('/api/v1/catalog/filters', async (request) => {
    const ctx = readContext(request);
    const filters = await queryService.getFilterDefinitions(ctx);
    return { data: filters };
  });
}

function readContext(request: FastifyRequest): {
  salesChannelCode?: string | undefined;
  preferredLanguage?: string | undefined;
} {
  const salesChannelCode = salesChannelHeaderSchema.parse(request.headers['x-sales-channel']);
  const acceptLanguage = acceptLanguageHeaderSchema.parse(request.headers['accept-language']);
  const preferredLanguage = acceptLanguage ? acceptLanguage.split(',')[0]?.trim() : undefined;
  return {
    salesChannelCode,
    preferredLanguage,
  };
}

/**
 * Parses list-query parameters out of the request URL, including the nested
 * `filter[attr.<key>]=value` syntax. We hand-parse this because Fastify's
 * default query parser flattens bracketed keys into strings.
 */
function parseListQuery(request: FastifyRequest): {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]>;
  changedSince?: string | undefined;
} {
  const raw = (request.query ?? {}) as Record<string, unknown>;

  const q = typeof raw['q'] === 'string' ? raw['q'] : undefined;
  const limitRaw = typeof raw['limit'] === 'string' ? Number(raw['limit']) : undefined;
  const limit = Number.isFinite(limitRaw) && limitRaw! > 0 ? Math.min(200, limitRaw!) : 50;
  const cursor = typeof raw['cursor'] === 'string' ? raw['cursor'] : undefined;
  const changedSince = typeof raw['changedSince'] === 'string' ? raw['changedSince'] : undefined;

  let sort: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  const sortRaw = typeof raw['sort'] === 'string' ? raw['sort'] : undefined;
  if (sortRaw === 'relevance' || sortRaw === '-createdAt' || sortRaw === 'name' || sortRaw === '-name') {
    sort = sortRaw;
  }

  const attributeFilters: Record<string, string[]> = {};
  let categorySlug: string | undefined;
  for (const [key, value] of Object.entries(raw)) {
    const attrMatch = /^filter\[attr\.([^\]]+)\]$/.exec(key);
    if (attrMatch && attrMatch[1]) {
      const attrKey = attrMatch[1];
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      attributeFilters[attrKey] = values;
      continue;
    }
    if (key === 'filter[category]' && typeof value === 'string') {
      categorySlug = value;
    }
  }

  return {
    q,
    limit,
    cursor,
    sort,
    categorySlug,
    ...(Object.keys(attributeFilters).length > 0 ? { attributeFilters } : {}),
    changedSince,
  };
}
