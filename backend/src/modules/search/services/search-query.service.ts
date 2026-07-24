import type { EntityManager } from '@mikro-orm/postgresql';
import { Meilisearch, type SearchResponse } from 'meilisearch';
import { ERROR_CODES, type ProductSummary } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Product } from '../../catalog/entities/product.entity.js';
import type { CatalogAttributeReadService } from '../../catalog/services/catalog-attribute-read.service.js';
import { encodeCursor, decodeCursor } from '../../../http/cursor.js';
import { indexUidFor, type IndexedDocument } from './search-indexer.js';

/**
 * SearchQueryService (T068).
 *
 * Read-side bridge: translates the same query inputs `CatalogQueryService`
 * understands (`q`, `filter[attr.X]`, `categorySlug`, `sort`, `cursor`,
 * `limit`) into a Meilisearch query against the per-Sales-Channel index
 * the indexer maintains. Returns the same `ListResult<ProductSummary>`
 * shape so the route can call either backend interchangeably.
 *
 * Channel-scoped index choice is the read-side mirror of the indexer's
 * write-side: each Sales Channel writes to its own `products_<channel_code>`
 * index, so the channel filter is implicit in the index id.
 *
 * Pricing comes from Postgres at hydrate time so the Sales-Channel visibility
 * rule from `catalog-query.service.ts` (R-18: hide price on non-public
 * channels) is enforced without trusting whatever the indexer happened to
 * snapshot.
 */

/**
 * The request's resolved sales channel (feature 053 / FR-002), handed in by the
 * route from `request.salesChannel`. The search service no longer re-resolves
 * the channel from the raw header.
 */
export interface ResolvedSearchChannel {
  id: string;
  code: string;
  isPublic: boolean;
  defaultCurrency: string;
  defaultLanguage: string;
}

export interface SearchQueryContext {
  resolvedChannel: ResolvedSearchChannel;
  preferredLanguage?: string | undefined;
}

export interface SearchListProductsParams {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
}

export interface SearchListResult {
  data: ProductSummary[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

interface DocumentHit
  extends Pick<
    IndexedDocument,
    'id' | 'sku' | 'name' | 'slug' | 'type' | 'categorySlugs'
  > {
  primaryAssetUrl?: string | null;
}

export interface SearchQueryOptions {
  meilisearchHost?: string;
  meilisearchApiKey?: string;
}

export class SearchQueryService {
  private readonly client: Meilisearch;

  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 061 — the catalog's composed attribute read model (Principle I:
     * filterable validation reads the view, not the catalog entity).
     */
    private readonly attributeRead?: CatalogAttributeReadService,
    options: SearchQueryOptions = {},
  ) {
    const host =
      options.meilisearchHost ??
      process.env['MEILISEARCH_URL'] ??
      'http://localhost:7700';
    const apiKey =
      options.meilisearchApiKey ??
      process.env['MEILISEARCH_API_KEY'] ??
      undefined;
    this.client = new Meilisearch(apiKey ? { host, apiKey } : { host });
  }

  async listProducts(
    params: SearchListProductsParams,
    ctx: SearchQueryContext,
  ): Promise<SearchListResult> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    // Validate filter keys against the live composed attribute views so that an
    // unfilterable attribute returns the same 400 the Postgres path returns
    // (FR-005, T043). The Meilisearch index only enforces shape, not policy.
    if (params.attributeFilters) {
      const keys = Object.keys(params.attributeFilters);
      if (keys.length > 0) {
        if (!this.attributeRead) {
          throw new Error(
            'SearchQueryService: CatalogAttributeReadService is not wired — attribute-filter validation is unavailable.',
          );
        }
        const attrs = await this.attributeRead.listAll();
        const byKey = new Map(attrs.map((a) => [a.key, a]));
        for (const k of keys) {
          const a = byKey.get(k);
          if (!a || !a.isFilterable) {
            throw new HttpError(
              400,
              ERROR_CODES.FILTER_NOT_ALLOWED,
              `Attribute "${k}" is not filterable.`,
              [{ path: `filter[attr.${k}]`, issue: 'attribute is not filterable' }],
            );
          }
        }
      }
    }

    const indexUid = indexUidFor(channel);
    const index = this.client.index<DocumentHit & { updatedAt: number }>(indexUid);

    const offset = decodeOffsetCursor(params.cursor) ?? 0;
    const filter = buildFilterExpression(params);
    const sort = buildSort(params.sort);

    let response: SearchResponse<DocumentHit & { updatedAt: number }>;
    try {
      response = await index.search(params.q ?? '', {
        offset,
        // Over-fetch by one to detect hasMore.
        limit: params.limit + 1,
        ...(filter.length > 0 ? { filter } : {}),
        ...(sort.length > 0 ? { sort } : {}),
        attributesToRetrieve: [
          'id',
          'sku',
          'name',
          'slug',
          'type',
          'categorySlugs',
          'primaryAssetUrl',
        ],
      });
    } catch (err) {
      // Reserved-fallback (R-08): the dispatcher in routes.public.ts catches
      // this and re-runs the request through the Postgres path. Re-throw so
      // the caller can decide.
      throw new SearchBackendUnavailable(
        err instanceof Error ? err.message : String(err),
      );
    }

    const hits = response.hits.slice(0, params.limit);
    const hasMore = response.hits.length > params.limit;
    const nextCursor = hasMore ? encodeOffsetCursor(offset + params.limit) : null;

    if (hits.length === 0) {
      return {
        data: [],
        pagination: { cursor: nextCursor, hasMore, limit: params.limit },
      };
    }

    // Hydrate the channel-aware price + multilingual name override from
    // Postgres. This protects against stale index data and keeps R-18
    // (hide price on non-public channels) authoritative on Postgres.
    const products = await em.find(Product, {
      id: { $in: hits.map((h) => h.id) },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    const summaries: ProductSummary[] = [];
    for (const hit of hits) {
      const product = productById.get(hit.id);
      if (!product) continue; // Index pointed at a deleted row.
      summaries.push(
        toSummary(product, hit, channel, ctx.preferredLanguage),
      );
    }

    return {
      data: summaries,
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

}

export class SearchBackendUnavailable extends Error {
  constructor(message: string) {
    super(`Meilisearch unavailable: ${message}`);
    this.name = 'SearchBackendUnavailable';
  }
}

export function buildFilterExpression(
  params: Pick<SearchListProductsParams, 'attributeFilters' | 'categorySlug'>,
): string[] {
  const out: string[] = [];
  if (params.categorySlug) {
    out.push(`categorySlugs = "${escapeFilterValue(params.categorySlug)}"`);
  }
  if (params.attributeFilters) {
    for (const [key, values] of Object.entries(params.attributeFilters)) {
      if (values.length === 0) continue;
      const orParts = values.map(
        (v) => `attributes.${key} = "${escapeFilterValue(v)}"`,
      );
      out.push(`(${orParts.join(' OR ')})`);
    }
  }
  return out;
}

export function buildSort(
  sort: SearchListProductsParams['sort'],
): string[] {
  if (sort === undefined || sort === 'relevance') return [];
  if (sort === '-createdAt') return ['updatedAt:desc'];
  if (sort === 'name') return ['name:asc'];
  if (sort === '-name') return ['name:desc'];
  return [];
}

function escapeFilterValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function encodeOffsetCursor(offset: number): string {
  return encodeCursor(JSON.stringify({ offset }));
}

function decodeOffsetCursor(cursor: string | undefined): number | null {
  if (!cursor) return null;
  const raw = decodeCursor(cursor);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { offset?: number };
    if (typeof parsed.offset !== 'number' || !Number.isFinite(parsed.offset)) {
      return null;
    }
    return Math.max(0, parsed.offset);
  } catch {
    return null;
  }
}

function toSummary(
  product: Product,
  hit: DocumentHit,
  channel: ResolvedSearchChannel,
  preferredLanguage: string | undefined,
): ProductSummary {
  const rawPrice = Number(
    product.attributeValues['defaultPrice'] ??
      product.attributeValues['price'] ??
      Number.NaN,
  );
  const currency = channel?.defaultCurrency ?? 'PLN';
  const showPrice = channel?.isPublic ?? true;
  const price =
    showPrice && Number.isFinite(rawPrice) ? { amount: rawPrice, currency } : null;

  return {
    id: product.id,
    sku: product.sku,
    type: product.type,
    name: pickLang(product.name, preferredLanguage, channel) || hit.name,
    slug: product.slug,
    categorySlugs: hit.categorySlugs,
    primaryAssetUrl: hit.primaryAssetUrl ?? null,
    price,
    stockIndicator: null,
    stockLevel: null,
  };
}

function pickLang(
  blob: Record<string, string>,
  preferred: string | undefined,
  channel: ResolvedSearchChannel,
): string {
  const candidates = [
    preferred,
    channel?.defaultLanguage,
    'en-US',
    'en',
  ].filter((v): v is string => typeof v === 'string');
  for (const lang of candidates) {
    const hit = blob[lang];
    if (hit) return hit;
  }
  const anyKey = Object.keys(blob)[0];
  return anyKey ? (blob[anyKey] ?? '') : '';
}
