import { Meilisearch, MeilisearchApiError, type SearchResponse } from 'meilisearch';
import {
  ERROR_CODES,
  isProductVisibleTo,
  listingPriceMoney,
  type CatalogAttributeReadPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type ListingPrice,
  type ListingPricePort,
  type OrganizationDetailsPort,
  type PriceOrganization,
  type ProductAudience,
  type ProductSummary,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { encodeCursor, decodeCursor } from '../../../http/cursor.js';
import {
  indexUidFor,
  type IndexedDocument,
  type SortableAttribute,
} from './search-indexer.js';

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
  /** Who is asking (issue #227) — see the published `SearchQueryContext`. */
  audience: ProductAudience;
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
    /**
     * `organizations`' read model, for the customer group a group-targeted
     * price list is selected by. The module already resolves this port for the
     * typeahead popup, which has priced per buyer since feature 075 — the
     * result feed under the popup did not, so one search box quoted two
     * different figures for one product depending on whether the buyer stopped
     * at the suggestions or pressed Enter.
     *
     * Optional only in the signature, and never reached by an anonymous query.
     */
    private readonly organizations?: OrganizationDetailsPort,
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
      // Reserved-fallback (R-08): `searchQueryPort` converts this into the
      // `index-unavailable` arm and `catalog`'s listing re-runs the request
      // through the Postgres path. Re-throw so the owner's port can decide.
      //
      // Issue #287 — but say *which* failure it was. Every failure of this
      // call used to be wrapped as "unavailable", so a healthy engine
      // refusing the query (`invalid_search_sort`, because the index carried
      // no sortable attributes; `index_not_found`; a bad API key) was filed
      // under the one heading an operator reads as transient. The degrade is
      // still a degrade — a public catalogue must not 503 because search is
      // unhappy — but a refusal is a defect on this side of the wire, so it
      // names the engine's own error code and gets reported by this module
      // rather than only by whoever happened to call it.
      throw searchBackendFailure(err, indexUid);
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
    //
    // Issue #227 — and the audience answer, for the same reason and in the
    // same place. It is **not** pushed into the Meilisearch filter expression:
    // the index carries `visibility` but has never carried
    // `allowed_organization_ids`, so a filter there could cover one of the two
    // columns and would still need this pass to be correct — while reading, to
    // the next author, as though the question were settled upstream. The cost
    // is the one this path already pays for a stale index: a page can come
    // back shorter than `limit`.
    const products = (await this.products.findByIds(hits.map((h) => h.id))).filter((p) =>
      isProductVisibleTo(p, ctx.audience),
    );
    const productById = new Map(products.map((p) => [p.id, p]));
    // A channel that withholds prices is not asked for them (R-18), so the
    // resolution never runs and every hit reports `null`.
    // The price is the *viewer's*, while the document stays everybody's. A
    // Meilisearch document has never carried a price and does not start now:
    // one index per sales channel, one document per product, and per-buyer
    // pricing would otherwise multiply the corpus by the customer base. This
    // pass already re-reads every hit from Postgres so a stale index cannot
    // decide what a buyer sees; resolving the price for the caller here costs
    // the page four statements (measured, `listing-price-viewer-cost.bench.ts`)
    // and leaves the index shared.
    const priceable = channel.isPublic && products.length > 0;
    const viewerOrganization = priceable
      ? await this.#viewerOrganization(ctx.audience)
      : null;
    const resolvedPrices =
      priceable
        ? await this.#requireListingPrices().resolveListingPrices({
            products,
            context: {
              salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
              organization: viewerOrganization,
            },
          })
        : new Map<string, ListingPrice>();
    const summaries: ProductSummary[] = [];
    for (const hit of hits) {
      const product = productById.get(hit.id);
      // Index pointed at a deleted row, or at one this audience may not see.
      if (!product) continue;
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

  #requireOrganizations(): OrganizationDetailsPort {
    if (!this.organizations) {
      throw new Error(
        'SearchQueryService: the organization read port is not wired — a signed-in buyer cannot be priced.',
      );
    }
    return this.organizations;
  }

  /**
   * The buying organisation a hit should be priced against — `null` for the
   * anonymous visitor, for a signed-in buyer with no Organization, and for one
   * whose Organization row is gone. The same three-way answer `catalog`'s
   * listing gives, deliberately: the two backends serve the same route.
   */
  async #viewerOrganization(audience: ProductAudience): Promise<PriceOrganization | null> {
    if (audience.organizationId === null) return null;
    const record = await this.#requireOrganizations().findById(audience.organizationId);
    if (!record) return null;
    return { id: record.id, customerGroupId: record.customerGroupId };
  }
}

/**
 * Why the index did not answer this query — issue #287.
 *
 * `unreachable` is the engine being down, unroutable or timing out: transient,
 * nobody's mistake, and the Postgres fallback is the whole answer.
 *
 * `refused` is the engine answering, in milliseconds, that it will not run
 * *this* query — an unsortable attribute, a missing index, a rejected API key.
 * It is deterministic, it will not pass on its own, and it is a defect in this
 * module's configuration of the index. Both still degrade to Postgres; only
 * one of them is worth waking somebody for.
 */
export type SearchBackendFailureKind = 'unreachable' | 'refused';

export class SearchBackendUnavailable extends Error {
  constructor(
    message: string,
    /** Which of the two facts this is. */
    readonly kind: SearchBackendFailureKind = 'unreachable',
    /** Meilisearch's own error code for a refusal; `null` when unreachable. */
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'SearchBackendUnavailable';
  }
}

/**
 * Conditions this module has already reported. Module scope and never reset —
 * the same shape `plugin.ts` uses for an out-of-scope setting (D-43), and for
 * the same reason: an index setting is a deployment fact, and a public listing
 * would otherwise report it on every request of every page.
 */
const reportedSearchRefusals = new Set<string>();

/**
 * Classify a failed Meilisearch call, and report a refusal once per code.
 *
 * The report is `console.error` rather than a request logger because the
 * failure belongs to the module, not to the request that happened to hit it —
 * the same call fails identically for the reindex sweep and the typeahead —
 * and because the consumer's own line (`meilisearch unavailable; falling back
 * to postgres`, at `warn`) is the line this exists to contradict.
 */
function searchBackendFailure(err: unknown, indexUid: string): SearchBackendUnavailable {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof MeilisearchApiError ? err.response.status : null;
  // A 4xx is the engine declining the request. 429 is not: it is the engine
  // saying "not now", which is an availability answer.
  const refused = status !== null && status >= 400 && status < 500 && status !== 429;
  if (!refused) return new SearchBackendUnavailable(`Meilisearch unavailable: ${message}`);

  const code =
    (err instanceof MeilisearchApiError ? err.cause?.code : undefined) ?? `http_${status}`;
  if (!reportedSearchRefusals.has(code)) {
    reportedSearchRefusals.add(code);
    console.error(
      `search: Meilisearch refused a query on "${indexUid}" with "${code}" — this is a ` +
        `configuration defect, not an outage, and every affected listing is silently ` +
        `falling back to Postgres until it is fixed. ${message}`,
    );
  }
  return new SearchBackendUnavailable(
    `Meilisearch refused the query (${code}): ${message}`,
    'refused',
    code,
  );
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

/**
 * A Meilisearch sort expression this module is allowed to build — issue #287.
 *
 * The field half is {@link SortableAttribute}, so a sort naming something the
 * indexer never declared sortable does not compile. That is the compile-time
 * half of the guarantee; `SORTABLE_ATTRIBUTES` being the indexer's own input is
 * the other half. Before the two were tied together, `buildSort` returned
 * plain `string[]` and cheerfully asked five live indexes to sort on fields
 * they had never been told about.
 */
export type SearchSortExpression = `${SortableAttribute}:${'asc' | 'desc'}`;

export function buildSort(
  sort: SearchListProductsParams['sort'],
): SearchSortExpression[] {
  // `relevance` and the absent sort both leave the ordering to the engine's
  // ranking rules, which need no sortable attribute.
  if (sort === undefined || sort === 'relevance') return [];
  if (sort === '-createdAt') return ['createdAt:desc'];
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
