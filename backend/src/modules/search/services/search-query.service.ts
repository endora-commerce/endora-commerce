import { Meilisearch, type SearchResponse } from 'meilisearch';
import {
  ERROR_CODES,
  listingPriceMoney,
  type CatalogAttributeReadPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type ListingPrice,
  type ListingPricePort,
  type ProductSummary,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
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
 * route via `getResolvedChannel()`. The search service no longer re-resolves
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
    /**
     * Issue #153 — `catalog`'s product rows, over the port, where an
     * `EntityManager` and `em.find(Product, …)` used to be.
     *
     * The `EntityManager` could not leave while `catalog/plugin.ts` built this
     * class itself: a second module's composition decided what this
     * constructor took. It resolves `searchQueryPort` now, so the hydration
     * below asks `catalog` for its rows and answers 503 `MODULE_DISABLED` when
     * `catalog` is off — which is right, because `search`'s manifest declares
     * `catalog` and an index over a catalogue that is gone has nothing to
     * hydrate against.
     */
    private readonly products: CatalogProductReadPort,
    /**
     * Feature 061 — the catalog's composed attribute read model (Principle I:
     * filterable validation reads the view, not the catalog entity). Feature
     * 075, Phase C — typed as the published port; `catalog`'s own service
     * satisfies it structurally, so its construction of this class is unchanged.
     */
    private readonly attributeRead?: CatalogAttributeReadPort,
    options: SearchQueryOptions = {},
    /**
     * Issue #132 — the pricing engine, through the `pricingService` port. The
     * hydration below exists so that Postgres, not the index, decides what a
     * hit shows; the price it hydrates now comes from the engine for the same
     * reason.
     */
    private readonly listingPrices?: ListingPricePort,
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
    const channel = ctx.resolvedChannel;

    // Validate filter keys against the live composed attribute views so that an
    // unfilterable attribute returns the same 400 the Postgres path returns
    // (FR-005, T043). The Meilisearch index only enforces shape, not policy.
    if (params.attributeFilters) {
      const keys = Object.keys(params.attributeFilters);
      if (keys.length > 0) {
        if (!this.attributeRead) {
          throw new Error(
            'SearchQueryService: the catalog attribute read port is not wired — attribute-filter validation is unavailable.',
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
    const products = await this.products.findByIds(hits.map((h) => h.id));
    const productById = new Map(products.map((p) => [p.id, p]));
    // A channel that withholds prices is not asked for them (R-18), so the
    // resolution never runs and every hit reports `null`.
    const resolvedPrices =
      channel.isPublic && products.length > 0
        ? await this.#requireListingPrices().resolveListingPrices({
            products,
            context: {
              salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
            },
          })
        : new Map<string, ListingPrice>();
    const summaries: ProductSummary[] = [];
    for (const hit of hits) {
      const product = productById.get(hit.id);
      if (!product) continue; // Index pointed at a deleted row.
      summaries.push(
        searchHitSummary(
          product,
          hit,
          channel,
          ctx.preferredLanguage,
          resolvedPrices.get(product.id),
        ),
      );
    }

    return {
      data: summaries,
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  #requireListingPrices(): ListingPricePort {
    if (!this.listingPrices) {
      throw new Error(
        'SearchQueryService: the pricing port is not wired — a search hit cannot be priced.',
      );
    }
    return this.listingPrices;
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

/**
 * Project one hydrated hit into a `ProductSummary` (issue #132).
 *
 * `resolvedPrice` is the chain's answer for this product, or `undefined` when
 * the channel withheld the resolution — both render `null`, which is the one
 * spelling `ProductSummary.price` has for "no price". Exported so the
 * projection can be asserted without a Meilisearch round trip.
 */
export function searchHitSummary(
  product: CatalogProductRecord,
  hit: DocumentHit,
  channel: ResolvedSearchChannel,
  preferredLanguage: string | undefined,
  resolvedPrice: ListingPrice | undefined,
): ProductSummary {
  const price = resolvedPrice === undefined ? null : listingPriceMoney(resolvedPrice);

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
