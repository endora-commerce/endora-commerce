import { Meilisearch, MeilisearchApiError, type SearchResponse } from 'meilisearch';
import {
  ERROR_CODES,
  effectiveSystemText,
  isOrderMinimumEligibleType,
  listingPriceChannelContext,
  resolveScopeLanguage,
  listingPriceMoney,
  scopeLanguageOf,
  type CatalogAttributeReadPort,
  type CatalogProductAvailabilityPort,
  type CatalogProductUrlKeyReadPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type ListingPrice,
  type ListingPriceDetail,
  type ListingPriceDetailPort,
  type OrganizationDetailsPort,
  type OverrideRow,
  type PriceOrganization,
  type ProductAudience,
  type ProductListSort,
  type ProductSummary,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { encodeCursor, decodeCursor } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { availabilityFilter } from './search-availability.js';
import { attributesToSearchOnFor, indexLanguagesOf, nameSortField } from './search-document.js';
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
 * Pricing comes from Postgres at hydrate time, resolved for the viewer, so the
 * display-mode chain decides what a hit shows — a viewer whose mode is `none`
 * is sent no amount (issues #491, #492) — without trusting whatever the indexer
 * happened to snapshot.
 */

/**
 * The request's resolved sales channel (feature 053 / FR-002), handed in by the
 * route via `getResolvedChannel()`. The search service no longer re-resolves
 * the channel from the raw header.
 */
export interface ResolvedSearchChannel {
  id: string;
  code: string;
  defaultCurrency: string;
  defaultLanguage: string;
  /** Feature 163 — the channel's content languages (the published `ResolvedSearchChannel`). */
  languages?: readonly string[] | undefined;
}

/**
 * Feature 163 — the scope language L of a query: the request's pick resolved
 * against the channel's own languages (R7); the default language always counts
 * as offered.
 */
export function searchScopeLanguage(channel: ResolvedSearchChannel, preferredLanguage: string | undefined): string {
  const languages = [...(channel.languages ?? [])];
  if (!languages.includes(channel.defaultLanguage)) languages.unshift(channel.defaultLanguage);
  return resolveScopeLanguage({ id: channel.id, languages, defaultLanguage: channel.defaultLanguage }, preferredLanguage);
}

/** A language tag as an index field path may carry it (R21): letters, digits and hyphens. */
const FIELD_PATH_LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

/**
 * Feature 172 (`contracts/search-index.md` §3, R21) — the language whose `texts.<L>.*` a query
 * reads: {@link searchScopeLanguage}, checked against the channel's own languages and the tag
 * grammar **before** it is interpolated into a field path. A value that fails either is refused
 * (it cannot come from the resolver; reaching here means a caller bypassed it).
 */
export function queryLanguageOf(channel: ResolvedSearchChannel, preferredLanguage: string | undefined): string {
  const language = searchScopeLanguage(channel, preferredLanguage);
  const offered = indexLanguagesOf({ languages: channel.languages ?? [], defaultLanguage: channel.defaultLanguage });
  if (!offered.includes(language) || !FIELD_PATH_LANGUAGE.test(language)) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The search language is not one this channel offers.');
  }
  return language;
}

export interface SearchQueryContext {
  resolvedChannel: ResolvedSearchChannel;
  /** Who is asking (issue #227) — see the published `SearchQueryContext`. */
  audience: ProductAudience;
  preferredLanguage?: string | undefined;
  /** The currency the page is priced in (issue #249) — see the published `SearchQueryContext`. */
  currency?: string | undefined;
}

export interface SearchListProductsParams {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  /**
   * The catalogue's own sort union, so this backend and the Postgres one keep
   * sharing one input type — the published `SearchListProductsParams` names the
   * same type and the two would otherwise disagree the moment the contract
   * grew a member.
   *
   * Feature 086 added `price` / `-price`, and neither can reach this backend:
   * `catalog/routes.public.ts` routes a price ordering to Postgres before it
   * chooses Meilisearch, because the index has never carried a price and its
   * `sort` is a tie-break sequence that cannot express the resolution chain's
   * coalesce. {@link buildSort} answers `[]` for both — issue #287 made that
   * answer safe rather than silent, since a field outside
   * `SORTABLE_ATTRIBUTES` no longer compiles.
   */
  sort?: ProductListSort | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
}

export interface SearchListResult {
  data: ProductSummary[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

export interface DocumentHit
  extends Pick<
    IndexedDocument,
    'id' | 'sku' | 'slug' | 'type' | 'categorySlugs'
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
    private readonly listingPrices?: ListingPriceDetailPort,
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
    /**
     * Feature 163 — `catalog`'s availability answer, asked again for every
     * hit at (channel, L) for the caller, now. Optional only in the
     * signature: hydration without it fails loudly rather than trusting the
     * index.
     */
    private readonly availability?: Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveOrderRules'>,
    /**
     * Feature 163 (T113a, R28) — the effective URL key per channel language, so a
     * card links to the key that resolves at the request's (channel, language).
     * Absent (a rig that wires none), a card keeps the global key.
     */
    private readonly urlKeys?: Pick<CatalogProductUrlKeyReadPort, 'effectiveKeys'>,
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
    // Feature 172 (FR-033) — the one language this query reads texts in, validated first (R21).
    const queryLanguage = queryLanguageOf(channel, ctx.preferredLanguage);

    const offset = decodeOffsetCursor(params.cursor) ?? 0;
    // Feature 163 (R8) — availability at (channel, L), the window at query time
    // and the audience go into the filter the page is cut from (issue #151),
    // never only into hydration.
    const filter = [
      ...buildFilterExpression(params),
      availabilityFilter({
        languageCode: queryLanguage,
        audience: ctx.audience,
        nowMs: Date.now(),
      }),
    ];
    const sort = buildSort(params.sort, queryLanguage);

    // Feature 172 (FR-033, `contracts/search-index.md` §3) — a query matches the texts of its
    // language only, `texts.<L>.*`, beside the SKU and the searchable non-text attributes. An
    // index not yet reindexed after the upgrade does not know the fields; it is asked again
    // without the restriction rather than refused (see below), and that is logged.
    const searchOn = params.q ? await this.#attributesToSearchOn(queryLanguage) : null;
    const runSearch = (restrict: boolean) =>
      index.search(params.q ?? '', {
        offset,
        // Over-fetch by one to detect hasMore.
        limit: params.limit + 1,
        ...(filter.length > 0 ? { filter } : {}),
        ...(sort.length > 0 ? { sort } : {}),
        ...(restrict && searchOn ? { attributesToSearchOn: searchOn } : {}),
        attributesToRetrieve: ['id', 'sku', 'slug', 'type', 'categorySlugs', 'primaryAssetUrl'],
      });
    let response: SearchResponse<DocumentHit & { updatedAt: number }>;
    try {
      try {
        response = await runSearch(true);
      } catch (err) {
        rethrowIfModuleDisabled(err);
        if (!(searchOn && err instanceof MeilisearchApiError && err.cause?.code === 'invalid_search_attributes_to_search_on')) {
          throw err;
        }
        // Feature 172 (§2) — a pre-172 index, until the boot check reindexes it.
        console.warn('[search] index without language-keyed texts; searching every field until it is reindexed', {
          indexUid,
        });
        response = await runSearch(false);
      }
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

    return {
      data: hits.length === 0 ? [] : await this.hydrateHits(hits, ctx),
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * The post-Meilisearch half of {@link listProducts}: re-read every hit from
   * Postgres and project it into the card the catalogue's listing would show.
   * Separate so the projection can be asserted without a search engine.
   */
  async hydrateHits(
    hits: readonly DocumentHit[],
    ctx: SearchQueryContext,
  ): Promise<ProductSummary[]> {
    const channel = ctx.resolvedChannel;

    // Hydrate the channel-aware price + multilingual name override from
    // Postgres. This protects against stale index data and keeps who sees a
    // price (the display-mode chain) authoritative on Postgres.
    //
    // Issue #227 — and the audience answer, for the same reason and in the
    // same place. It is **not** pushed into the Meilisearch filter expression:
    // the index carries `visibility` but has never carried
    // `allowed_organization_ids`, so a filter there could cover one of the two
    // columns and would still need this pass to be correct — while reading, to
    // the next author, as though the question were settled upstream. The cost
    // is the one this path already pays for a stale index: a page can come
    // back shorter than `limit`.
    //
    // Feature 163 — the question is now the whole of availability, asked of
    // `catalog` at (channel, L) for this caller, now: the index filter narrows
    // the page and this pass keeps a stale document from deciding a disclosure.
    const records = await this.products.findByIds(hits.map((h) => h.id));
    const available = await this.#requireAvailability().filterAvailable(
      records.map((p) => p.id),
      {
        channelId: channel.id,
        languageCode: searchScopeLanguage(channel, ctx.preferredLanguage),
        audience: ctx.audience,
      },
    );
    const products = records.filter((p) => available.has(p.id));
    const productById = new Map(products.map((p) => [p.id, p]));
    // The price is the *viewer's*, while the document stays everybody's. A
    // Meilisearch document has never carried a price and does not start now:
    // one index per sales channel, one document per product, and per-buyer
    // pricing would otherwise multiply the corpus by the customer base. This
    // pass already re-reads every hit from Postgres so a stale index cannot
    // decide what a buyer sees; resolving the price for the caller here costs
    // the page four statements (measured, `listing-price-viewer-cost.bench.ts`)
    // and leaves the index shared.
    const priceable = products.length > 0;
    const viewerOrganization = priceable
      ? await this.#viewerOrganization(ctx.audience)
      : null;
    // D-287 P0 — the details call, so a Meilisearch page carries the same
    // `resolvedPrice` a Postgres page does, from the same single resolution.
    const resolvedPrices =
      priceable
        ? await this.#requireListingPrices().resolveListingPriceDetails({
            products,
            context: {
              // Issue #249 — the currency the catalogue route resolved for this
              // page, so a Meilisearch page and a Postgres page price alike.
              ...listingPriceChannelContext(channel, ctx.currency),
              organization: viewerOrganization,
              // The customer's own group, as on the Postgres page.
              ...(viewerOrganization && ctx.audience.customerAccountId
                ? { customerAccountId: ctx.audience.customerAccountId }
                : {}),
            },
          })
        : new Map<string, ListingPriceDetail>();
    // Issue #384 — the request channel's value overrides for the page, in one
    // read, so a card's name is the one the catalogue's card shows for this
    // (channel, language). Not `hit.name`: the indexer resolves that in the
    // channel's default language only, so it is wrong for any other request
    // language — it stays what the index ranks and sorts by.
    const overridesByProduct = await this.#channelOverridesFor(products, channel.id);
    // Feature 163 — the card's link and minimum in this channel: the effective URL
    // key at (channel, L) (T113a, R28) and the channel's minimum (FR-100), one read
    // each for the page.
    const scopeLanguage = searchScopeLanguage(channel, ctx.preferredLanguage);
    const productIds = products.map((p) => p.id);
    const [keysByProduct, rulesByProduct] =
      productIds.length > 0
        ? await Promise.all([
            this.urlKeys ? this.urlKeys.effectiveKeys(productIds, channel.id) : Promise.resolve(new Map()),
            this.#requireAvailability().effectiveOrderRules(productIds, channel.id),
          ])
        : [new Map<string, Map<string, string>>(), new Map<string, { minOrderQuantity: number | null; returnable: boolean }>()];
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
          resolvedPrices.get(product.id)?.price,
          resolvedPrices.get(product.id),
          overridesByProduct.get(product.id),
          {
            slug: (keysByProduct as Map<string, Map<string, string>>).get(product.id)?.get(scopeLanguage),
            minOrderQuantity: rulesByProduct.has(product.id)
              ? (rulesByProduct.get(product.id)?.minOrderQuantity ?? null)
              : undefined,
          },
        ),
      );
    }

    return summaries;
  }

  /**
   * Feature 172 (`contracts/search-index.md` §3) — the fields a query in `languageCode` searches:
   * that language's texts, the SKU and the searchable attributes whose values are not text (a
   * text attribute is searched in `texts.<L>.attributes`). Mirrors `SearchIndexer.textInputs`.
   */
  async #attributesToSearchOn(languageCode: string): Promise<string[]> {
    const attributes = this.attributeRead ? await this.attributeRead.listAll() : [];
    return attributesToSearchOnFor(
      languageCode,
      attributes.filter((a) => a.isSearchable && a.valueType !== 'string').map((a) => a.key),
    );
  }

  #requireAvailability(): Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveOrderRules'> {
    if (!this.availability) {
      throw new Error(
        'SearchQueryService: the availability port is not wired — a hit cannot be hydrated without it.',
      );
    }
    return this.availability;
  }

  /** Every override row `channelId` holds for the page's products, bucketed by product. */
  async #channelOverridesFor(
    products: readonly CatalogProductRecord[],
    channelId: string,
  ): Promise<Map<string, OverrideRow[]>> {
    const byProduct = new Map<string, OverrideRow[]>();
    if (products.length === 0) return byProduct;
    const rows = await this.products.listValueOverridesByProductIds(
      products.map((p) => p.id),
      { channelId },
    );
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push(row);
      byProduct.set(row.productId, list);
    }
    return byProduct;
  }

  #requireListingPrices(): ListingPriceDetailPort {
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
  /** Feature 172 — the query's language, validated by {@link queryLanguageOf}: a name sorts in it. */
  languageCode: string,
): SearchSortExpression[] {
  // `relevance` and the absent sort both leave the ordering to the engine's
  // ranking rules, which need no sortable attribute.
  if (sort === undefined || sort === 'relevance') return [];
  if (sort === '-createdAt') return ['createdAt:desc'];
  if (sort === 'name') return [`${nameSortField(languageCode)}:asc`];
  if (sort === '-name') return [`${nameSortField(languageCode)}:desc`];
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
  /**
   * D-287 P0 — the base / sale / display-mode split from the same resolution,
   * projected onto `ProductSummary.resolvedPrice`. Omitted, the field is too.
   */
  detail?: ListingPriceDetail,
  /**
   * Issue #384 — this product's value-override rows for `channel`. A channel
   * override for the language the baseline pick lands on (or an earlier leg of
   * its chain) wins over that pick; omitted or empty, the name is exactly what
   * it was before.
   */
  overrides?: readonly OverrideRow[],
  /**
   * Feature 163 — the product's values in this channel: the effective URL key at
   * the request's (channel, language) (T113a) and the channel's minimum (FR-100).
   * An absent value keeps the record's.
   */
  inChannel: { slug?: string | undefined; minOrderQuantity?: number | null | undefined } = {},
): ProductSummary {
  const price = resolvedPrice === undefined ? null : listingPriceMoney(resolvedPrice);

  return {
    id: product.id,
    sku: product.sku,
    type: product.type,
    // Feature 172 (FR-030) — the card's name at the request's (C, L), C×L → C → Global, from the
    // hydrated rows: never the index, which a stale document could have left behind.
    name:
      effectiveSystemText(
        overrides,
        'name',
        { channelId: channel.id, languageCode: scopeLanguageOf(channel, preferredLanguage) },
        product.name,
      ) ?? product.name,
    slug: inChannel.slug ?? product.slug,
    categorySlugs: hit.categorySlugs,
    primaryAssetUrl: hit.primaryAssetUrl ?? null,
    price,
    stockIndicator: null,
    stockLevel: null,
    // Feature 155 (FR-014) — from the hydrated record, never from the index;
    // emitted for the types the minimum applies to only.
    minOrderQuantity: isOrderMinimumEligibleType(product.type)
      ? inChannel.minOrderQuantity !== undefined
        ? inChannel.minOrderQuantity
        : product.minOrderQuantity
      : null,
    ...(detail
      ? {
          resolvedPrice: {
            basePrice: detail.basePrice,
            salePrice: detail.salePrice,
            displayMode: detail.displayMode,
            // Feature 161 (G19) — the list price beside a lower buyer price, as on the catalogue cards.
            ...(detail.listPrice ? { listPrice: { amount: detail.listPrice.amount, currency: detail.listPrice.currency } } : {}),
          },
        }
      : {}),
  };
}

