import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CatalogQueryService } from './services/catalog-query.service.js';
import type { ProductLinkService } from './services/product-link.service.js';
import type { BundleService } from './services/bundle.service.js';
import {
  productLinkKindSchema,
  validateBundleConfigurationRequestSchema,
} from '@b2b/contracts';
import {
  SearchBackendUnavailable,
  type SearchQueryService,
} from '../search/services/search-query.service.js';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';

/**
 * Public catalog routes (US1 read surface).
 * Storefront SSR + crawlers + anonymous API consumers. No auth.
 *
 * Read-backend selection (T067/T068):
 *   - When `CATALOG_SEARCH_BACKEND=meilisearch` AND a SearchQueryService was
 *     injected, list-products is served from Meilisearch.
 *   - On any Meilisearch failure (`SearchBackendUnavailable`), the route
 *     transparently degrades to the Postgres path (R-08 reserved-fallback,
 *     so search is never fully broken).
 *   - The `changedSince` query param stays on Postgres because it has no
 *     equivalent in the Meilisearch index today.
 *   - Default backend remains Postgres so existing tests + deployments
 *     keep their behaviour without an opt-in.
 */

const acceptLanguageHeaderSchema = z.string().optional();

export interface CatalogPublicDeps {
  queryService: CatalogQueryService;
  /** Optional Meilisearch read backend; routed through when env enables it. */
  searchQueryService?: SearchQueryService;
  /**
   * Feature 002 US4 — public ProductLink reads. Optional so foundation-era
   * tests/composition that don't wire it stay green; when undefined, the
   * `/products/:id/links` route is not registered.
   */
  productLinkService?: ProductLinkService;
  /**
   * Feature 002 US5 — public bundle-configuration validation. Optional
   * for the same reason as productLinkService.
   */
  bundleService?: BundleService;
  /**
   * Resolves the `general.product_image_placeholder_url` setting (global or
   * per sales channel) for the given channel code. Returns the configured URL,
   * or null when unset / on any resolution error. When supplied, storefront
   * product summaries and details with no image of their own fall back to it.
   */
  resolveProductImagePlaceholderUrl?: (
    salesChannelCode: string | undefined,
  ) => Promise<string | null>;
}

export async function registerCatalogPublicRoutes(
  app: FastifyInstance,
  deps: CatalogPublicDeps,
): Promise<void> {
  const { queryService, searchQueryService } = deps;
  const resolvePlaceholder = deps.resolveProductImagePlaceholderUrl;

  // Fills `primaryAssetUrl` on imageless summaries with the configured
  // placeholder (resolved once per request, only when at least one item needs
  // it). Leaves products that already have an image untouched.
  async function withListPlaceholder<
    T extends { data: Array<{ primaryAssetUrl: string | null }> },
  >(result: T, salesChannelCode: string | undefined): Promise<T> {
    if (!resolvePlaceholder) return result;
    if (!result.data.some((p) => !p.primaryAssetUrl)) return result;
    const url = await resolvePlaceholder(salesChannelCode);
    if (!url) return result;
    return {
      ...result,
      data: result.data.map((p) =>
        p.primaryAssetUrl ? p : { ...p, primaryAssetUrl: url },
      ),
    };
  }

  // GET /api/v1/catalog/products
  app.get('/api/v1/catalog/products', async (request, reply) => {
    const { q, limit, cursor, sort, categorySlug, attributeFilters, changedSince } =
      parseListQuery(request);
    const ctx = readContext(request);

    const useMeili =
      process.env['CATALOG_SEARCH_BACKEND'] === 'meilisearch' &&
      searchQueryService !== undefined &&
      changedSince === undefined;
    if (useMeili) {
      try {
        const result = await searchQueryService.listProducts(
          {
            ...(q !== undefined ? { q } : {}),
            limit,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(sort !== undefined ? { sort } : {}),
            ...(categorySlug !== undefined ? { categorySlug } : {}),
            ...(attributeFilters !== undefined ? { attributeFilters } : {}),
          },
          ctx,
        );
        reply.header('x-search-backend', 'meilisearch');
        return await withListPlaceholder(result, ctx.resolvedChannel.code);
      } catch (err) {
        if (err instanceof SearchBackendUnavailable) {
          request.log.warn(
            { err: err.message },
            'meilisearch unavailable; falling back to postgres',
          );
        } else {
          throw err;
        }
      }
    }

    const result = await queryService.listProducts(
      { q, limit, cursor, sort, categorySlug, attributeFilters, changedSince },
      ctx,
    );
    reply.header('x-search-backend', 'postgres');
    return await withListPlaceholder(result, ctx.resolvedChannel.code);
  });

  // GET /api/v1/catalog/products/:idOrSlug
  app.get<{ Params: { idOrSlug: string } }>(
    '/api/v1/catalog/products/:idOrSlug',
    async (request) => {
      const ctx = readContext(request);
      const product = await queryService.getProductByIdOrSlug(request.params.idOrSlug, ctx);
      // Imageless product → fall back to the configured placeholder so the PDP
      // hero/card renders something instead of an empty box.
      if (
        resolvePlaceholder &&
        !product.primaryAssetUrl &&
        product.assets.length === 0
      ) {
        const url = await resolvePlaceholder(ctx.resolvedChannel.code);
        if (url) product.primaryAssetUrl = url;
      }
      return { data: product };
    },
  );

  // Feature 002 US4 — public Product Links read.
  if (deps.productLinkService) {
    const links = deps.productLinkService;
    app.get<{ Params: { idOrSlug: string }; Querystring: { kind?: string } }>(
      '/api/v1/catalog/products/:idOrSlug/links',
      async (request) => {
        const ctx = readContext(request);
        const product = await queryService.getProductByIdOrSlug(
          request.params.idOrSlug,
          ctx,
        );
        const kind = request.query.kind
          ? productLinkKindSchema.parse(request.query.kind)
          : undefined;
        const rows = await links.listForStorefront(product.id, ctx, kind);
        return { data: rows };
      },
    );
  }

  // Feature 002 US5 — public bundle-configuration validation. Pure
  // compute, no state mutation; only POST on the public surface. Errors
  // are returned inside the data envelope so the storefront can highlight
  // each offending slot — except PRODUCT_TYPE_MISMATCH (400) and
  // PRODUCT_NOT_FOUND (404), which are HTTP-level rejections.
  if (deps.bundleService) {
    const bundle = deps.bundleService;
    app.post<{ Params: { idOrSlug: string } }>(
      '/api/v1/catalog/products/:idOrSlug/bundle-configuration/validate',
      {
        schema: { body: validateBundleConfigurationRequestSchema },
      },
      async (request) => {
        const ctx = readContext(request);
        const product = await queryService.getProductByIdOrSlug(
          request.params.idOrSlug,
          ctx,
        );
        const body = validateBundleConfigurationRequestSchema.parse(request.body);
        const result = await bundle.validateConfiguration(product.id, body.selections);
        return { data: result };
      },
    );
  }

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
  resolvedChannel: {
    id: string;
    code: string;
    isPublic: boolean;
    defaultCurrency: string;
    defaultLanguage: string;
  };
  preferredLanguage?: string | undefined;
} {
  // Feature 053 / FR-002: the sales channel is resolved once by the canonical
  // middleware. Read it here instead of re-parsing the `x-sales-channel` header.
  const ch = getResolvedChannel(request);
  const acceptLanguage = acceptLanguageHeaderSchema.parse(request.headers['accept-language']);
  const preferredLanguage = acceptLanguage ? acceptLanguage.split(',')[0]?.trim() : undefined;
  return {
    resolvedChannel: {
      id: ch.id,
      code: ch.code,
      isPublic: ch.isPublic,
      defaultCurrency: ch.defaultCurrency,
      defaultLanguage: ch.defaultLanguage,
    },
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
