import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../entities/product.entity.js';
import { ProductVariant } from '../entities/product-variant.entity.js';
import { Category } from '../entities/category.entity.js';
import { AttributeSet } from '../entities/attribute-set.entity.js';
import type {
  CatalogAttributeReadService,
  CatalogAttributeView,
} from './catalog-attribute-read.service.js';
import { GalleryItem } from '../entities/gallery-item.entity.js';
import { GalleryItemLabel } from '../entities/gallery-item-label.entity.js';
import { ProductAttachment } from '../entities/product-attachment.entity.js';
import { AttachmentType } from '../entities/attachment-type.entity.js';
import type { ProductLinkService } from './product-link.service.js';

import { GroupedItem } from '../entities/grouped-item.entity.js';
import { ProductPackagingUnit } from '../entities/product-packaging-unit.entity.js';
import { BundleSlot } from '../entities/bundle-slot.entity.js';
import { BundleSlotOption } from '../entities/bundle-slot-option.entity.js';
import { resolvePrimaryAssetUrls } from './primary-asset-url.js';
import { viewerOrganizationFor } from './viewer-organization.js';
import {
  ERROR_CODES,
  isPriceSort,
  isProductVisibleTo,
  listingPriceMoney,
  type AssetReadPort,
  type AssetRecord,
  type CategoryNode,
  type CustomFieldDefinitionReadPort,
  type FilterDefinition,
  type ListingPrice,
  type ListingPriceOrderCursor,
  type ListingPriceOrderPort,
  type ListingPricePort,
  type ListingPriceViewerContext,
  type OrganizationDetailsPort,
  type ProductAudience,
  type ProductDetail,
  type ProductListSort,
  type ProductSummary,
  type ProductVariant as VariantDto,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import { HttpError } from '../../../http/error-envelope.js';
import { encodeCursor, decodeCursor } from '../../../http/cursor.js';

function encodeObjectCursor(value: object): string {
  return encodeCursor(JSON.stringify(value));
}

function decodeObjectCursor<T>(cursor: string): T | null {
  const raw = decodeCursor(cursor);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Catalog read-path service (US1). Consumed by the storefront and by external
 * integrations pulling `/catalog/products?changedSince=...`.
 *
 * Sales-channel awareness: each public endpoint resolves the requested channel
 * (default: the one marked `isPublic=true` when no channel was specified) and
 * applies the visibility rules from R-18 — non-public channels omit the `price`
 * field from anonymous responses.
 *
 * For MVP, text search is Postgres ILIKE on the multilingual `name`/`description`
 * blobs. The Meilisearch-backed query path lives in the `search` module
 * (tasks T067/T068); this service falls back to it transparently when available.
 */

/**
 * The request's sales channel, resolved once by the canonical resolver
 * middleware (feature 053 / FR-002). The catalog reads it from the request
 * context instead of re-resolving from the raw header. `isPublic` is the
 * price-visibility flag (display concern, distinct from resolution).
 */
export interface CatalogResolvedChannel {
  id: string;
  code: string;
  isPublic: boolean;
  defaultCurrency: string;
  defaultLanguage: string;
}

export interface CatalogQueryContext {
  /** The request's resolved sales channel (from `getResolvedChannel()`). */
  resolvedChannel: CatalogResolvedChannel;
  /**
   * Who is asking (issue #227). Every read in this service applies
   * {@link isProductVisibleTo} with it, next to the channel filter that was
   * already here — `visibility` and `allowed_organization_ids` were read by no
   * query on this surface, so an anonymous `GET` of a product an operator
   * marked `organization_restricted` returned it in full.
   *
   * **Required, not defaulted.** A default would have to be the anonymous
   * audience to fail closed, and a route that forgot to resolve its caller
   * would then quietly stop serving the buyer their own restricted catalogue —
   * a bug that reads as "the operator's allow-list does not work" and is found
   * by nobody. Two route files pass it; `tsc` names the third.
   */
  audience: ProductAudience;
  /**
   * Language preference — BCP-47. Used to pick the right string out of the
   * multilingual JSONB blobs. Falls back to the Sales Channel's default language,
   * then to any available key.
   */
  preferredLanguage?: string | undefined;
}

/**
 * The two reads a listing card needs beyond the product row and its price:
 * which image represents the product, and which category slugs it carries.
 *
 * Both are resolved for the whole page and keyed by product id, because both
 * used to run once per card — and neither varies by viewer or by sales channel,
 * so there is no dimension the page-wide key drops. (The channel decides
 * whether the product is on the page at all, and the audience decides whether
 * the caller may see it; both are settled before either read.)
 */
export interface ListingCardReads {
  /** Product id -> the T096 chain's answer, `null` when nothing represents it. */
  assetUrlByProduct: Map<string, string | null>;
  /** Product id -> its category slugs, in `product_categories` primary-key order. */
  categorySlugsByProduct: Map<string, string[]>;
}

export interface ListProductsParams {
  q?: string | undefined;
  limit: number;
  cursor?: string | undefined;
  sort?: ProductListSort | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
  changedSince?: string | undefined;
  /** Feature 086 — inclusive bounds on the viewer's own resolved unit price. */
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
}

/**
 * How many source rows a price-ordered or price-filtered page may read before it
 * returns short — FR-019, stated as the specification requires and **not** as a
 * setting (research §R13).
 *
 * Eight times the page size. On the reference corpus it never bound: the first
 * page of 50 cost 213 source rows against a budget of 400. It binds only where
 * an operator restricts most of a catalogue from most viewers, and the answer
 * there is a short page — which is this listing's existing behaviour, since the
 * channel and audience filters already narrow a fetched page — rather than an
 * unbounded scan.
 *
 * A setting was rejected because nobody has the number yet: the value it should
 * take is a function of how much of a catalogue a deployment hides, and shipping
 * an operator knob for a guess is the shape Constitution IV refuses. The `warn`
 * below is what turns the question into evidence; adding the setting afterwards
 * is additive.
 */
export const PRICE_PAGE_SCAN_BUDGET_MULTIPLE = 8;

/** The cursor a price-ordered listing issues. Opaque to every caller. */
type PriceListingCursor =
  | { stream: 'priced'; amount: string; productId: string }
  | { stream: 'tail'; createdAt: string; id: string };

/**
 * The cursor a listing that pages by a keyset issues. Opaque to every caller,
 * and **shaped by the ordering it was issued under** — see `keysetFor`.
 */
type ListingKeysetCursor = { createdAt: string; id: string } | { slug: string; id: string };

/**
 * A keyset: how to name the last row of a chunk, and how to ask for the rows
 * that sort strictly after it.
 */
interface ListingKeyset {
  /** The cursor payload for a row a chunk ended on. */
  of(product: Product): ListingKeysetCursor;
  /**
   * The decoded cursor, or `null` when it was issued under another ordering.
   * Discarding it is the existing behaviour for a cursor that does not parse,
   * and it is what a keyset over the wrong column has to do rather than
   * reinterpret one column's value as another's.
   */
  parse(decoded: unknown): ListingKeysetCursor | null;
  /** The `where` fragment selecting everything strictly after that row. */
  after(cursor: ListingKeysetCursor): Record<string, unknown>;
}

/**
 * The "everything strictly after this row" predicate, over whichever column the
 * cursor names and in the direction that column is ordered in.
 *
 * One implementation for both shapes rather than one per keyset: they differ
 * only in the column, and a second copy of this predicate is how it and the
 * ordering came apart in the first place.
 */
function afterKeysetCursor(
  cursor: ListingKeysetCursor,
  op: '$gt' | '$lt',
): Record<string, unknown> {
  if ('slug' in cursor) {
    return {
      $or: [{ slug: { [op]: cursor.slug } }, { slug: cursor.slug, id: { [op]: cursor.id } }],
    };
  }
  const at = new Date(cursor.createdAt);
  return { $or: [{ createdAt: { [op]: at } }, { createdAt: at, id: { [op]: cursor.id } }] };
}

export interface ListResult<T> {
  data: T[];
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

export class CatalogQueryService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * Feature 002 US4 — optional link provider so the PDP `productDetail`
     * carries the pre-grouped Related/Up-sell/Cross-sell links. Optional
     * so tests/composition that don't wire it stay green; when undefined,
     * `productDetail.links` is omitted from the response.
     */
    private readonly productLinkService?: ProductLinkService,
    /**
     * Feature 055 (US4) — optional custom-field definition source. When wired,
     * Category custom fields flagged `config.filterable === true` are merged into
     * the storefront filter set. The catalog interprets the opaque `config` here;
     * the custom-fields core stays unaware of catalog (Principle XIV / FR-006).
     */
    private readonly customFieldDefinitions?: CustomFieldDefinitionReadPort,
    /**
     * Feature 061 — composed attribute read model. Required for every
     * attribute-metadata read (filters, PDP visible attributes, promo-rule and
     * comparable key ports); optional in the signature so product-only
     * fixtures keep constructing the service without attribute wiring.
     */
    private readonly attributeRead?: CatalogAttributeReadService,
    /**
     * Issue #132 — the pricing engine, resolved through the `pricingService`
     * port. Every storefront-facing price this service emits comes from here;
     * the catalogue no longer projects its own legacy default-price attribute,
     * because that figure is not a price any price list stands behind.
     *
     * Optional only in the signature, and unwiring it is not a fallback: a
     * listing asked to render a price without it fails loudly, the same way an
     * unwired attribute read model does. `null` from the port is the engine's
     * own "nothing applies" answer and is rendered as an absence.
     */
    private readonly listingPrices?: ListingPricePort,
    /**
     * Feature 075 — `assets_library`'s read port, where six raw
     * `join assets a on a.id = …` clauses and an `em.find(Asset, …)` used to
     * be. The bridge rows are still this module's; only the asset row is asked
     * of its owner.
     *
     * Optional only in the signature, for the same reason the two above are:
     * a fixture that renders no image never reaches it. A PDP that does and
     * finds it unwired fails loudly rather than silently dropping every image.
     */
    private readonly assets?: AssetReadPort,
    /**
     * Issue #185 — the kernel's channel-membership accessor, where the
     * hand-written `select product_id from sales_channel_products …` in
     * {@link filterByChannel} used to be. Constitution XII says the
     * `sales_channel_*` bridges are read and written only through this service;
     * the query here named the table itself, which crosses the boundary while
     * naming no import specifier.
     *
     * Optional only in the signature, and unwiring it is not a fallback: the
     * channel filter fails loudly rather than quietly answering the full
     * cross-channel set, which is the one degrade Principle XII rules out.
     */
    private readonly channelMembership?: SalesChannelMembershipPort,
    /**
     * `organizations`' read model, for the one field the pricing engine needs
     * beyond the viewer's organisation id: the customer group a group-targeted
     * price list is selected by. Without it a buyer's catalogue card and their
     * own cart line would resolve against different lists and quote different
     * figures for one product.
     *
     * Optional only in the signature, and unwiring it is not a fallback: a
     * listing asked to price a signed-in buyer without it fails loudly, the
     * same way the two ports above do. An **anonymous** listing never reaches
     * it, which is what keeps the fixtures that construct this service with no
     * organisation wiring working unchanged.
     */
    private readonly organizationDetails?: OrganizationDetailsPort,
    /**
     * Feature 086 — the `ListingPriceOrderPort` slice of the same
     * `pricingService` container {@link listingPrices} resolves.
     *
     * A separate constructor argument rather than a widened type on that one,
     * because every fixture that builds this service with a listing-price stub
     * would otherwise stop compiling for a capability it does not exercise. It
     * is the same container, the same gate and the same declared edge — the port
     * doc block says so, and `check:port-shape` compares it against the
     * registration.
     *
     * Optional only in the signature, and unwiring it is not a fallback: a
     * price-ordered listing asked for without it fails loudly rather than
     * silently serving the default ordering under a `sort=price` the buyer
     * chose.
     */
    private readonly listingPriceOrder?: ListingPriceOrderPort,
    /**
     * Feature 086 — where the scan budget says it bound.
     *
     * The budget is a constant rather than a setting because nobody has the
     * number yet (research §R13), and this line is what turns the question into
     * evidence instead of leaving it a guess: a deployment whose pages come back
     * short says so in its own log, and the setting can be added afterwards
     * without changing anything else. Optional, because a fixture that never
     * binds never reaches it.
     */
    private readonly log?: { warn(obj: object, msg: string): void },
  ) {}

  #requireChannelMembership(): SalesChannelMembershipPort {
    if (!this.channelMembership) {
      throw new Error(
        'CatalogQueryService: the channel-membership port is not wired — a channel-scoped ' +
          'listing cannot be answered without leaking the cross-channel set.',
      );
    }
    return this.channelMembership;
  }

  #requireAssets(): AssetReadPort {
    if (!this.assets) {
      throw new Error(
        'CatalogQueryService: the asset read port is not wired — product images are unavailable.',
      );
    }
    return this.assets;
  }

  #requireAttributeRead(): CatalogAttributeReadService {
    if (!this.attributeRead) {
      throw new Error(
        'CatalogQueryService: CatalogAttributeReadService is not wired — attribute reads are unavailable.',
      );
    }
    return this.attributeRead;
  }

  #requireListingPrices(): ListingPricePort {
    if (!this.listingPrices) {
      throw new Error(
        'CatalogQueryService: the pricing port is not wired — a listing cannot be priced.',
      );
    }
    return this.listingPrices;
  }

  #requireListingPriceOrder(): ListingPriceOrderPort {
    if (!this.listingPriceOrder) {
      throw new Error(
        'CatalogQueryService: the pricing ordering port is not wired — a price sort or a ' +
          'price range cannot be answered, and answering it with another ordering would be ' +
          'a sort control that silently does nothing.',
      );
    }
    return this.listingPriceOrder;
  }

  #requireOrganizationDetails(): OrganizationDetailsPort {
    if (!this.organizationDetails) {
      throw new Error(
        'CatalogQueryService: the organization read port is not wired — a signed-in buyer cannot be priced.',
      );
    }
    return this.organizationDetails;
  }

  /**
   * The chain's answer for a batch of products, keyed by product id, **for the
   * viewer in front of the page**.
   *
   * A non-public sales channel withholds prices (R-18), and it withholds them
   * *before* the resolution rather than after: the catalogue has nothing to ask
   * about on a channel whose prices it may not show.
   *
   * The organisation is the whole of this method's share of the owner's ruling
   * — an anonymous visitor sees the channel price, a signed-in buyer sees their
   * organisation's. It is resolved once per page rather than per card, and it
   * is `null` for every caller {@link viewerOrganizationFor} answers `null`
   * for, so the anonymous request issues exactly the resolution it issued
   * before and lands on exactly the cache entry it landed on before.
   */
  async #listingPricesFor(
    products: readonly Product[],
    channel: CatalogResolvedChannel | undefined,
    audience: ProductAudience,
  ): Promise<Map<string, ListingPrice>> {
    if (products.length === 0) return new Map();
    if (!(channel?.isPublic ?? true)) return new Map();
    return this.#requireListingPrices().resolveListingPrices({
      products,
      context: await this.#viewerPricingContext(channel, audience),
    });
  }

  /**
   * The viewer, as every pricing seam on this service reads them: the resolved
   * channel and the buying organisation, or no organisation at all.
   *
   * Extracted so the page's prices and the page's **ordering** are resolved for
   * one viewer rather than two — a card priced for the buyer and an order
   * computed for somebody else is the exact failure feature 086 exists to
   * prevent, and it would be one forgotten argument away if each seam built its
   * own context.
   */
  async #viewerPricingContext(
    channel: CatalogResolvedChannel | undefined,
    audience: ProductAudience,
  ): Promise<ListingPriceViewerContext> {
    const organization =
      audience.organizationId === null
        ? null
        : await viewerOrganizationFor(this.#requireOrganizationDetails(), audience);
    return {
      salesChannel: {
        id: channel?.id ?? '',
        defaultCurrency: channel?.defaultCurrency ?? 'PLN',
      },
      organization,
    };
  }

  /**
   * `ProductSummary.price` for one resolved chain answer. A product the channel
   * withholds prices for is absent from the map and renders `null`, and so does
   * the chain's `none` arm — the wire field has one spelling for "no price".
   */
  #summaryPrice(
    resolved: Map<string, ListingPrice>,
    productId: string,
  ): { amount: number; currency: string } | null {
    const price = resolved.get(productId);
    return price === undefined ? null : listingPriceMoney(price);
  }

  /**
   * {@link ListingCardReads} for a page, in a fixed number of statements
   * regardless of how many cards it holds (issue #263).
   *
   * `resolvePrimaryAssetUrls` has taken an id list since feature 075 and needs
   * no change — it was simply never handed more than one id from here, which is
   * MR !793's finding repeating itself: a helper that batches in signature
   * batches in practice only where the *page* is what calls it.
   *
   * The slug read carries an explicit `order by pc.product_id, pc.category_id`.
   * That is not a new ordering: `product_categories` is keyed on exactly that
   * pair, so the per-card `where pc.product_id = ?` was already answered from
   * that index in that order. Writing it down is what keeps the array the same
   * array now that a page-wide `in (…)` may reach the rows by another plan.
   */
  async #listingCardReadsFor(
    em: EntityManager,
    productIds: readonly string[],
  ): Promise<ListingCardReads> {
    const categorySlugsByProduct = new Map<string, string[]>();
    if (productIds.length === 0) {
      return { assetUrlByProduct: new Map(), categorySlugsByProduct };
    }

    // Primary asset — for listings prefer the gallery's Thumbnail (US3),
    // then Base Image, then any first gallery item, finally the legacy
    // product_assets row. Resolution chain pinned by T096.
    const assetUrlByProduct = await resolvePrimaryAssetUrls(em, this.#requireAssets(), productIds);

    const ids = [...productIds];
    const catRows = await em.execute<{ product_id: string; slug: string }[]>(
      `select pc.product_id::text as product_id, c.slug
         from product_categories pc
         join categories c on c.id = pc.category_id
        where pc.product_id in (${ids.map(() => '?').join(',')})
        order by pc.product_id, pc.category_id`,
      ids,
    );
    for (const row of catRows) {
      const slugs = categorySlugsByProduct.get(row.product_id) ?? [];
      slugs.push(row.slug);
      categorySlugsByProduct.set(row.product_id, slugs);
    }

    return { assetUrlByProduct, categorySlugsByProduct };
  }

  // ------------------------------------------------------------------
  // Products
  // ------------------------------------------------------------------

  async listProducts(
    params: ListProductsParams,
    ctx: CatalogQueryContext,
  ): Promise<ListResult<ProductSummary>> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    // --- Filter validation: any filter[attr.<key>] where the attribute is
    // not filterable must return 400 FILTER_NOT_ALLOWED (FR-005, T043).
    if (params.attributeFilters) {
      const keys = Object.keys(params.attributeFilters);
      if (keys.length > 0) {
        const views = await this.#requireAttributeRead().listAll();
        const byKey = new Map(views.map((a) => [a.key, a]));
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

    const where: Record<string, unknown> = {
      status: 'active',
      deletedAt: null,
    };
    if (params.q) {
      // MVP: DB-only search. Production target uses Meilisearch behind this
      // same query method (T067/T068 — Phase 10 polish); for now we match:
      //   1. SKU ILIKE (covers the seeded EXAMPLE-… ids)
      //   2. attributeValues at any key flagged isSearchable=true
      // The attribute-values match uses Postgres ILIKE on the JSONB cast to
      // text, which is fine for the test corpus and good enough until Meili.
      const searchableKeys = await this.searchableAttributeKeys(em);
      const orClauses: Array<Record<string, unknown>> = [
        { sku: { $ilike: `%${params.q}%` } },
      ];
      for (const key of searchableKeys) {
        // MikroORM's `expr()` would be cleaner; raw cast keeps the dependency
        // surface minimal here.
        orClauses.push({
          // Match any product whose attributeValues[key] (case-insensitive)
          // contains the query.
          attributeValues: this.searchableJsonbClause(key, params.q),
        });
      }
      where['$or'] = orClauses;
    }
    if (params.changedSince) {
      where['updatedAt'] = { $gt: new Date(params.changedSince) };
    }

    // Feature 086 — the two paths that read the viewer's own price. Both are
    // chunked and both are bounded; everything else takes the single fetch it
    // always took.
    if (isPriceSort(params.sort)) {
      return this.#listByViewerPrice(em, params, ctx, where, params.sort);
    }
    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      return this.#listWithPriceRange(em, params, ctx, where);
    }

    // Cursor decoding — over the keyset this ordering pages by, which is
    // `{ createdAt, id }` for the default sort and `{ slug, id }` for `name`.
    const keyset = this.keysetFor(params.sort);
    let cursorClause: Record<string, unknown> | null = null;
    if (params.cursor) {
      const decoded = keyset.parse(decodeObjectCursor<unknown>(params.cursor));
      if (decoded) cursorClause = keyset.after(decoded);
    }

    const effectiveWhere = cursorClause ? { $and: [where, cursorClause] } : where;

    // Over-fetch by one to detect hasMore.
    const products = await em.find(Product, effectiveWhere, {
      limit: params.limit + 1,
      orderBy: this.orderForSort(params.sort),
    });

    const hasMore = products.length > params.limit;
    const page = hasMore ? products.slice(0, params.limit) : products;
    const nextCursor =
      hasMore && page.length > 0 ? encodeObjectCursor(keyset.of(page[page.length - 1]!)) : null;

    // Sales Channel membership — only products associated with the channel are
    // returned, failing closed to the empty set.
    const visibleIds = await this.filterByChannel(
      page.map((p) => p.id),
      channel,
    );

    // Attribute filter post-filtering (simple equality on attributeValues JSONB).
    const filtered = page.filter((p) => visibleIds.has(p.id) && this.#passesPageFilters(p, params, ctx));

    // Category filter
    let categoryFilteredIds: Set<string> | null = null;
    if (params.categorySlug) {
      categoryFilteredIds = await this.productIdsInCategoryTree(em, params.categorySlug);
    }

    // Build the summaries. The page is resolved **once** — `toSummary` used to
    // ask `price_lists` for a batch of one, so a 50-card page made 50 calls and
    // paid the resolution's fixed cost (the active lists, the settings pair, the
    // organisation's chain) 50 times over. Resolving the page here and handing
    // the map down is what makes `resolveListingPrices` a batch in practice
    // rather than only in signature.
    //
    // Its asset and its category slugs are resolved the same way and for the
    // same reason (issue #263): both helpers took an id list already, and both
    // were being handed one id at a time from inside the loop.
    const priceable = filtered.filter((p) =>
      categoryFilteredIds ? categoryFilteredIds.has(p.id) : true,
    );
    const resolvedPrices = await this.#listingPricesFor(priceable, channel, ctx.audience);
    const cardReads = await this.#listingCardReadsFor(em, priceable.map((p) => p.id));
    const summaries = priceable.map((p) =>
      this.toSummary(p, channel, ctx.preferredLanguage, resolvedPrices, cardReads),
    );

    return {
      data: summaries,
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * The channel/audience/attribute predicates a fetched page is narrowed by,
   * for one product.
   *
   * The channel test is the caller's, because it is one `in (…)` for the whole
   * chunk; the other two are per row and were already written inline. They are
   * collected here so the price paths below apply **exactly** the same
   * narrowing as the default path — a price ordering that filtered differently
   * would make a hidden row observable through a position or a page boundary,
   * which is the disclosure FR-014 forbids and which neither the relevance sort
   * nor the name sort could have had.
   */
  #passesPageFilters(
    product: Product,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
  ): boolean {
    // Issue #227 — the second scoping axis, alongside the channel one. It is
    // applied on the page rather than in the `where` because the allow-list
    // test is a JSONB containment the ORM query object cannot spell, and
    // splitting the two axes across the query and the page would leave the
    // `limit` accounting to reason about twice instead of once. The known cost
    // is a page narrowed after the fetch coming back shorter than `limit`, and
    // it is bounded by how much of a catalogue an operator restricts.
    if (!isProductVisibleTo(product, ctx.audience)) return false;
    if (!params.attributeFilters) return true;
    for (const [k, values] of Object.entries(params.attributeFilters)) {
      const av = product.attributeValues[k];
      if (av === undefined) return false;
      if (!values.map((v) => String(v)).includes(String(av))) return false;
    }
    return true;
  }

  /** The two range bounds as decimal strings — the comparison happens in `numeric`. */
  #amountRange(params: ListProductsParams): { min?: string; max?: string } | undefined {
    if (params.minPrice === undefined && params.maxPrice === undefined) return undefined;
    return {
      ...(params.minPrice !== undefined ? { min: params.minPrice.toFixed(4) } : {}),
      ...(params.maxPrice !== undefined ? { max: params.maxPrice.toFixed(4) } : {}),
    };
  }

  /**
   * The listing ordered by **the viewer's own** resolved unit price (feature
   * 086, US1/US2/US4).
   *
   * Two streams, in this order and never the other way round:
   *
   *  1. the **priced** stream, which `price_lists` answers in resolved-price
   *     order over its own tables. This service intersects every chunk with
   *     channel membership, `isProductVisibleTo` and the attribute filters
   *     before a row can reach the page, the cursor or a count — the port
   *     cannot do it, says so in its own contract, and a chunk from it may name
   *     products the viewer must never see;
   *  2. the **tail**: visible products no applicable price list prices. They
   *     appear, at the end, **in both directions**, ordered among themselves by
   *     the listing's default ordering. "No price" is not a large number or a
   *     small one — it is the absence of the value being ordered by — so a tail
   *     that flipped with the direction would lead "most expensive first" with
   *     the products nobody has priced, which reads as a bug on every shop that
   *     has one.
   *
   * **The tail is excluded by a price range** (FR-012): a range is a claim about
   * a number, and a product with no number does not satisfy it. That is the one
   * place the answer is exclusion, and it is exclusion from a filter the buyer
   * typed rather than from the catalogue.
   *
   * **The legacy product price attribute joins the tail rather than
   * interleaving** (spec 086, clarification 1). `listingPriceFrom`'s second arm
   * — the price assigned directly to the Product — is not part of the ordering:
   * the priced stream is the price-list relation, and everything else is the
   * tail. Measured incidence of a product carrying that attribute *and* priced
   * by no active list: zero. Interleaving it would mean ordering across
   * `price_list_price_brackets` and `products.attribute_values` in one
   * statement — two modules' tables, which `check:module-boundary` refuses — and
   * the operator's remedy is one action: price the product on the default list.
   * The decision is expressed here, in which set feeds which stream, and
   * nowhere else.
   */
  async #listByViewerPrice(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    where: Record<string, unknown>,
    sort: 'price' | '-price',
  ): Promise<ListResult<ProductSummary>> {
    const channel = ctx.resolvedChannel;
    const direction = sort === 'price' ? 'asc' : 'desc';
    const context = await this.#viewerPricingContext(channel, ctx.audience);
    const amountRange = this.#amountRange(params);
    const restrictToProductIds = params.categorySlug
      ? [...(await this.productIdsInCategoryTree(em, params.categorySlug))]
      : undefined;

    const decoded = params.cursor ? decodeObjectCursor<PriceListingCursor>(params.cursor) : null;
    // A cursor issued under another sort is discarded rather than
    // reinterpreted: the existing behaviour for a cursor that does not parse.
    const startInTail = decoded?.stream === 'tail';
    let priceCursor: ListingPriceOrderCursor | null =
      decoded?.stream === 'priced' ? { amount: decoded.amount, productId: decoded.productId } : null;
    let tailCursor: { createdAt: string; id: string } | null =
      decoded?.stream === 'tail' ? { createdAt: decoded.createdAt, id: decoded.id } : null;

    const budget = PRICE_PAGE_SCAN_BUDGET_MULTIPLE * params.limit;
    // Over-fetch by one, exactly as the default path does, so a full page and
    // its `hasMore` come out of **one** chunk. Asking for `limit` instead costs
    // a second round trip on every full page — measured at four extra
    // statements, and invisible to a ceiling expressed as an absolute number.
    const target = params.limit + 1;
    const chunkSize = params.limit + 1;
    let spent = 0;
    let bound = false;

    const collected: Product[] = [];
    const cursors: PriceListingCursor[] = [];
    let pricedExhausted = startInTail;

    // --- the priced stream -------------------------------------------------
    while (!pricedExhausted && collected.length < target) {
      if (spent >= budget) {
        bound = true;
        break;
      }
      const chunk = await this.#requireListingPriceOrder().orderByUnitPrice({
        context,
        direction,
        after: priceCursor,
        limit: chunkSize,
        ...(restrictToProductIds !== undefined ? { restrictToProductIds } : {}),
        ...(amountRange ? { amountRange } : {}),
      });
      spent += Math.max(chunk.sourceRowsRead, chunk.rows.length);
      pricedExhausted = chunk.exhausted;
      if (chunk.rows.length === 0) {
        if (!chunk.exhausted) continue;
        break;
      }
      const last = chunk.rows[chunk.rows.length - 1]!;
      priceCursor = { amount: last.amount, productId: last.productId };

      const byId = await this.#visibleProductsInOrder(
        em,
        chunk.rows.map((row) => row.productId),
        where,
        params,
        ctx,
      );
      for (const row of chunk.rows) {
        const product = byId.get(row.productId);
        if (!product) continue;
        collected.push(product);
        cursors.push({ stream: 'priced', amount: row.amount, productId: row.productId });
        if (collected.length >= target) break;
      }
    }

    // --- the unpriced tail -------------------------------------------------
    // Skipped entirely under a range filter (FR-012), and only entered once the
    // priced stream is genuinely over — `exhausted`, which a short chunk does
    // not imply, because the provider may have stopped on its own bound.
    const wantsTail = amountRange === undefined && pricedExhausted && !bound;
    if (wantsTail) {
      const categoryIds = params.categorySlug
        ? new Set(restrictToProductIds ?? [])
        : null;
      while (collected.length < target) {
        if (spent >= budget) {
          bound = true;
          break;
        }
        const chunkWhere = tailCursor
          ? {
              $and: [
                where,
                {
                  $or: [
                    { createdAt: { $lt: new Date(tailCursor.createdAt) } },
                    { createdAt: new Date(tailCursor.createdAt), id: { $lt: tailCursor.id } },
                  ],
                },
              ],
            }
          : where;
        const rows = await em.find(Product, chunkWhere, {
          limit: chunkSize,
          // The listing's own default ordering, in both directions: the tail is
          // not ordered by a price it does not have.
          orderBy: { createdAt: 'desc', id: 'desc' },
        });
        spent += rows.length;
        if (rows.length === 0) break;
        const lastRow = rows[rows.length - 1]!;
        tailCursor = { createdAt: lastRow.createdAt.toISOString(), id: lastRow.id };

        const priced = await this.#requireListingPriceOrder().pricedProductIds({
          context,
          productIds: rows.map((r) => r.id),
        });
        const candidates = rows.filter(
          (r) => !priced.has(r.id) && (categoryIds === null || categoryIds.has(r.id)),
        );
        const visibleIds = await this.filterByChannel(
          candidates.map((r) => r.id),
          channel,
        );
        for (const product of candidates) {
          if (!visibleIds.has(product.id)) continue;
          if (!this.#passesPageFilters(product, params, ctx)) continue;
          collected.push(product);
          cursors.push({
            stream: 'tail',
            createdAt: product.createdAt.toISOString(),
            id: product.id,
          });
          if (collected.length >= target) break;
        }
        if (rows.length < chunkSize) break;
      }
    }

    if (bound) {
      this.log?.warn(
        { budget, spent, limit: params.limit, sort },
        'catalog: price-ordered page hit its scan budget and is returning short',
      );
    }

    const hasMore = collected.length > params.limit;
    const page = collected.slice(0, params.limit);
    const nextCursor =
      hasMore && page.length > 0 ? encodeObjectCursor(cursors[params.limit - 1]!) : null;

    const resolvedPrices = await this.#listingPricesFor(page, channel, ctx.audience);
    const cardReads = await this.#listingCardReadsFor(em, page.map((p) => p.id));
    return {
      data: page.map((p) =>
        this.toSummary(p, channel, ctx.preferredLanguage, resolvedPrices, cardReads),
      ),
      // No total count, no rank, no "showing 51–100 of 4 213" (FR-015): an
      // aggregate over the priced set is an aggregate over rows the viewer may
      // not be allowed to see.
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * A price **range** under an ordering that is not a price ordering (research
   * §R12).
   *
   * The ordering is this module's own and the price is a predicate it cannot
   * spell, so the page is walked in chunks and each chunk is narrowed by the
   * prices it was **already going to resolve** — `resolveListingPrices` is
   * called for the page whatever the sort, so in the common case this costs no
   * additional query at all. The failure mode is a short page under a highly
   * selective range, which is this listing's existing behaviour rather than a
   * new one, and it is bounded by the same scan budget.
   *
   * A product no applicable list prices is excluded, exactly as it is under a
   * price ordering: the chain's `none` and `product` arms are both absences of
   * a price-list figure, and a range is a claim about one.
   */
  async #listWithPriceRange(
    em: EntityManager,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
    where: Record<string, unknown>,
  ): Promise<ListResult<ProductSummary>> {
    const channel = ctx.resolvedChannel;
    const min = params.minPrice;
    const max = params.maxPrice;
    const categoryFilteredIds = params.categorySlug
      ? await this.productIdsInCategoryTree(em, params.categorySlug)
      : null;

    // The chunk walk and the page it hands back page by the same keyset, and
    // that keyset is the one this ordering sorts on — `keysetFor`.
    const keyset = this.keysetFor(params.sort);
    let cursor: ListingKeysetCursor | null = params.cursor
      ? keyset.parse(decodeObjectCursor<unknown>(params.cursor))
      : null;
    const budget = PRICE_PAGE_SCAN_BUDGET_MULTIPLE * params.limit;
    const target = params.limit + 1;
    // Over-fetch by one, for the same reason the price path does: a full page
    // and its `hasMore` should come out of one chunk.
    const chunkSize = params.limit + 1;
    let spent = 0;
    let bound = false;

    const collected: Product[] = [];
    const prices = new Map<string, ListingPrice>();

    while (collected.length < target) {
      if (spent >= budget) {
        bound = true;
        break;
      }
      const chunkWhere = cursor ? { $and: [where, keyset.after(cursor)] } : where;
      const rows = await em.find(Product, chunkWhere, {
        limit: chunkSize,
        orderBy: this.orderForSort(params.sort),
      });
      spent += rows.length;
      if (rows.length === 0) break;
      const lastRow = rows[rows.length - 1]!;
      cursor = keyset.of(lastRow);

      const visibleIds = await this.filterByChannel(
        rows.map((r) => r.id),
        channel,
      );
      const candidates = rows.filter(
        (r) =>
          visibleIds.has(r.id) &&
          this.#passesPageFilters(r, params, ctx) &&
          (categoryFilteredIds === null || categoryFilteredIds.has(r.id)),
      );
      const chunkPrices = await this.#listingPricesFor(candidates, channel, ctx.audience);
      for (const product of candidates) {
        const price = chunkPrices.get(product.id);
        if (price === undefined || price.source !== 'price_list') continue;
        const amount = Number(price.amount);
        if (!Number.isFinite(amount)) continue;
        if (min !== undefined && amount < min) continue;
        if (max !== undefined && amount > max) continue;
        collected.push(product);
        prices.set(product.id, price);
        if (collected.length >= target) break;
      }
      if (rows.length < chunkSize) break;
    }

    if (bound) {
      this.log?.warn(
        { budget, spent, limit: params.limit, sort: params.sort ?? 'relevance' },
        'catalog: price-filtered page hit its scan budget and is returning short',
      );
    }

    const hasMore = collected.length > params.limit;
    const page = collected.slice(0, params.limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeObjectCursor(keyset.of(last)) : null;
    const cardReads = await this.#listingCardReadsFor(em, page.map((p) => p.id));
    return {
      data: page.map((p) =>
        this.toSummary(p, channel, ctx.preferredLanguage, prices, cardReads),
      ),
      pagination: { cursor: nextCursor, hasMore, limit: params.limit },
    };
  }

  /**
   * The products behind an ordered chunk of ids, narrowed by everything this
   * module narrows a page by, keyed by id.
   *
   * The order comes from the caller, not from here: `em.find` with an `in (…)`
   * answers in whatever order it likes, and the ordering being reproduced is the
   * price one.
   */
  async #visibleProductsInOrder(
    em: EntityManager,
    productIds: readonly string[],
    where: Record<string, unknown>,
    params: ListProductsParams,
    ctx: CatalogQueryContext,
  ): Promise<Map<string, Product>> {
    const out = new Map<string, Product>();
    if (productIds.length === 0) return out;
    const rows = await em.find(Product, { $and: [where, { id: { $in: [...productIds] } }] });
    const visibleIds = await this.filterByChannel(
      rows.map((r) => r.id),
      ctx.resolvedChannel,
    );
    for (const product of rows) {
      if (!visibleIds.has(product.id)) continue;
      if (!this.#passesPageFilters(product, params, ctx)) continue;
      out.set(product.id, product);
    }
    return out;
  }

  async getProductByIdOrSlug(idOrSlug: string, ctx: CatalogQueryContext): Promise<ProductDetail> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const product = await em.findOne(Product, isUuid ? { id: idOrSlug } : { slug: idOrSlug });
    if (!product || product.deletedAt) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    if (product.status === 'inactive') {
      throw new HttpError(410, ERROR_CODES.PRODUCT_ARCHIVED, 'Product is inactive.');
    }

    // Visibility — if the product is not associated with the requested channel,
    // behave like it doesn't exist. Avoids exposing non-public catalogue.
    const visibleIds = await this.filterByChannel([product.id], channel);
    if (!visibleIds.has(product.id)) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    // Issue #227 — and the same answer for the audience axis. 404 rather than
    // 403: a caller who may not see the row may not learn it exists either,
    // and a 403 on a slug tells them it does. This is also the gate the
    // `/links` and `/bundle-configuration/validate` routes stand behind, since
    // both resolve their subject through here first.
    if (!isProductVisibleTo(product, ctx.audience)) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }

    const summary = this.toSummary(
      product,
      channel,
      ctx.preferredLanguage,
      await this.#listingPricesFor([product], channel, ctx.audience),
      await this.#listingCardReadsFor(em, [product.id]),
    );

    // Categories
    const categoryRows = await em.execute<{ category_id: string }[]>(
      `select category_id from product_categories where product_id = ?`,
      [product.id],
    );
    const categoryIds = categoryRows.map((r) => r.category_id);
    // Feature 068 — the PDP breadcrumb/category list is customer-facing: skip
    // deactivated categories, and deleted ones (never filtered here before).
    const categories = await em.find(Category, {
      id: { $in: categoryIds },
      deletedAt: null,
      isActive: true,
    });

    // Assets
    const assetRows = await em.execute<{ asset_id: string; position: number }[]>(
      `select asset_id, position from product_assets where product_id = ? order by position asc`,
      [product.id],
    );
    const assetIds = assetRows.map((r) => r.asset_id);
    const assets = await this.#requireAssets().findByIds(assetIds);

    // Variants
    const variants = product.type === 'configurable' ? await em.find(ProductVariant, { parentProductId: product.id }) : [];

    // Feature 002 — Attribute Set wired to this Product. Pulled in a
    // single findOne so PDP renders include the set's localized name
    // without a follow-up call.
    const attributeSetEntity = await em.findOne(AttributeSet, {
      id: product.attributeSetId,
    });

    // Feature 002 US3 — eager-load gallery + attachments for the PDP.
    // Gallery: items + label bridge zipped per item; Asset urls
    // resolved into a flat shape the storefront can render directly.
    const galleryItems = await em.find(
      GalleryItem,
      { productId: product.id },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const galleryAssetIds = galleryItems.map((g) => g.assetId);
    const galleryAssetsById = new Map<string, AssetRecord>();
    if (galleryAssetIds.length > 0) {
      const galleryAssets = await this.#requireAssets().findByIds(galleryAssetIds);
      for (const a of galleryAssets) galleryAssetsById.set(a.id, a);
    }
    const galleryLabels = galleryItems.length > 0
      ? await em.find(GalleryItemLabel, { productId: product.id })
      : [];
    const labelsByItem = new Map<string, ('base_image' | 'small_image' | 'thumbnail')[]>();
    for (const l of galleryLabels) {
      const existing = labelsByItem.get(l.galleryItemId) ?? [];
      existing.push(l.label);
      labelsByItem.set(l.galleryItemId, existing);
    }

    // Attachments + their types, eager-loaded in two queries.
    const attachmentRows = await em.find(
      ProductAttachment,
      { productId: product.id },
      { orderBy: { position: 'asc', id: 'asc' } },
    );
    const attachmentTypeIds = [...new Set(attachmentRows.map((a) => a.attachmentTypeId))];
    const attachmentTypesById = new Map<string, AttachmentType>();
    if (attachmentTypeIds.length > 0) {
      const types = await em.find(AttachmentType, { id: { $in: attachmentTypeIds } });
      for (const t of types) attachmentTypesById.set(t.id, t);
    }
    const attachmentAssetIds = [...new Set(attachmentRows.map((a) => a.assetId))];
    const attachmentAssetsById = new Map<string, AssetRecord>();
    if (attachmentAssetIds.length > 0) {
      const aAssets = await this.#requireAssets().findByIds(attachmentAssetIds);
      for (const a of aAssets) attachmentAssetsById.set(a.id, a);
    }

    const descriptionText = this.pickLang(product.description, ctx.preferredLanguage, channel);
    const nameText = this.pickLang(product.name, ctx.preferredLanguage, channel);

    // Feature 012 / FR-030 — "Parametry produktu" tab projection.
    // Resolve every attribute that is flagged isVisibleOnProductPage
    // AND has a non-empty value on this product. Render the value per
    // the active locale (option label for select / enum / multiselect,
    // formatted scalar otherwise). Sorted by AttributeSetAttribute
    // position when assigned, by attribute key otherwise.
    const visibleAttributes = await this.buildVisibleAttributesProjection(
      em,
      product,
      ctx.preferredLanguage,
      channel,
    );

    const detail: ProductDetail = {
      ...summary,
      description: descriptionText,
      attributeValues: this.coerceAttributeValues(product.attributeValues),
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        url: a.storageUrl,
        altText: a.altText ? this.pickLang(a.altText, ctx.preferredLanguage, channel) : null,
      })),
      variants: variants.map<VariantDto>((v) => ({
        id: v.id,
        sku: v.sku,
        variantAttributeValues: v.variantAttributeValues,
        priceOverride: v.priceOverride != null ? Number(v.priceOverride) : null,
        stockLevel: v.stockLevel ?? null,
      })),
      categories: categories.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
      })),
      seo: {
        metaTitle: nameText,
        metaDescription: descriptionText.slice(0, 160),
        openGraph: {
          title: nameText,
          description: descriptionText.slice(0, 240),
          // T097 — OG image prefers gallery Base Image (then Thumbnail,
          // then primaryAssetUrl). Base Image is the marketer's hero
          // shot, so social shares should land on it.
          imageUrl: (() => {
            const base = galleryItems
              .map((g) => ({
                asset: galleryAssetsById.get(g.assetId) ?? null,
                labels: labelsByItem.get(g.id) ?? [],
              }))
              .find((g) => g.asset && g.labels.includes('base_image'));
            if (base?.asset) return base.asset.storageUrl;
            const thumb = galleryItems
              .map((g) => ({
                asset: galleryAssetsById.get(g.assetId) ?? null,
                labels: labelsByItem.get(g.id) ?? [],
              }))
              .find((g) => g.asset && g.labels.includes('thumbnail'));
            if (thumb?.asset) return thumb.asset.storageUrl;
            return summary.primaryAssetUrl;
          })(),
        },
      },
      structuredDataJsonLd: {
        '@context': 'https://schema.org/',
        '@type': 'Product',
        name: nameText,
        sku: product.sku,
        description: descriptionText,
        ...(summary.price
          ? {
              offers: {
                '@type': 'Offer',
                price: summary.price.amount,
                priceCurrency: summary.price.currency,
                availability:
                  summary.stockIndicator === 'out_of_stock'
                    ? 'https://schema.org/OutOfStock'
                    : 'https://schema.org/InStock',
              },
            }
          : {}),
      },
      ...(attributeSetEntity
        ? {
            attributeSet: {
              id: attributeSetEntity.id,
              code: attributeSetEntity.code,
              name: attributeSetEntity.name,
            },
          }
        : {}),
      gallery: galleryItems.flatMap((g) => {
        const a = galleryAssetsById.get(g.assetId);
        if (!a) return [];
        return [
          {
            id: g.id,
            position: g.position,
            labels: [...(labelsByItem.get(g.id) ?? [])].sort(),
            asset: { id: a.id, kind: a.kind, url: a.storageUrl },
          },
        ];
      }),
      attachments: attachmentRows.flatMap((row) => {
        const t = attachmentTypesById.get(row.attachmentTypeId);
        const a = attachmentAssetsById.get(row.assetId);
        if (!t || !a) return [];
        return [
          {
            id: row.id,
            position: row.position,
            name: row.name,
            description: row.description ?? null,
            type: { id: t.id, code: t.code, name: t.name },
            asset: {
              id: a.id,
              kind: a.kind,
              url: a.storageUrl,
              filename: a.filename,
              sizeBytes: Number(a.sizeBytes),
              mimeType: a.mimeType,
            },
          },
        ];
      }),
      visibleAttributes,
    };

    // Feature 002 US4 — pre-grouped Product Links. Inactive targets and
    // channel-restricted ones are filtered by listForStorefront. Default
    // page sizes per spec.md US4 Assumptions: related=8, up-sell=4,
    // cross-sell=4.
    if (this.productLinkService) {
      const linkRows = await this.productLinkService.listForStorefront(
        product.id,
        {
          resolvedChannel: ctx.resolvedChannel,
          audience: ctx.audience,
          ...(ctx.preferredLanguage ? { preferredLanguage: ctx.preferredLanguage } : {}),
        },
      );
      const sliced = (rows: typeof linkRows, n: number): typeof linkRows =>
        rows.slice(0, n);
      detail.links = {
        related: sliced(
          linkRows.filter((l) => l.kind === 'related'),
          8,
        ),
        upSell: sliced(
          linkRows.filter((l) => l.kind === 'up_sell'),
          4,
        ),
        crossSell: sliced(
          linkRows.filter((l) => l.kind === 'cross_sell'),
          4,
        ),
      };
    }

    // Feature 002 US5 — type-discriminated composite payload. Only the
    // branch matching `product.type` is populated; other branches are
    // omitted so the response stays compact and the storefront can do a
    // simple type switch.
    if (product.type === 'grouped') {
      const items = await em.find(
        GroupedItem,
        { parentProductId: product.id },
        { orderBy: { position: 'asc', id: 'asc' } },
      );
      const childIds = items.map((i) => i.childProductId);
      const summaries = await this.summariesForIds(em, childIds, ctx, channel);
      detail.groupedItems = items.flatMap((i) => {
        const summary = summaries.get(i.childProductId);
        if (!summary) return [];
        return [{ id: i.id, position: i.position, quantity: i.quantity, product: summary }];
      });
    } else if (product.type === 'bundle') {
      const slots = await em.find(
        BundleSlot,
        { parentProductId: product.id },
        { orderBy: { position: 'asc', id: 'asc' } },
      );
      const slotIds = slots.map((s) => s.id);
      const options =
        slotIds.length > 0
          ? await em.find(
              BundleSlotOption,
              { slotId: { $in: slotIds } },
              { orderBy: { position: 'asc', id: 'asc' } },
            )
          : [];
      const optsBySlot = new Map<string, BundleSlotOption[]>();
      for (const opt of options) {
        const list = optsBySlot.get(opt.slotId) ?? [];
        list.push(opt);
        optsBySlot.set(opt.slotId, list);
      }
      const optionProductIds = [...new Set(options.map((o) => o.optionProductId))];
      const summaries = await this.summariesForIds(em, optionProductIds, ctx, channel);
      detail.bundleSlots = slots.map((s) => ({
        id: s.id,
        name: s.name,
        minQuantity: s.minQuantity,
        maxQuantity: s.maxQuantity,
        position: s.position,
        options: (optsBySlot.get(s.id) ?? []).flatMap((o) => {
          const summary = summaries.get(o.optionProductId);
          if (!summary) return [];
          return [
            {
              id: o.id,
              defaultQuantity: o.defaultQuantity,
              position: o.position,
              product: summary,
            },
          ];
        }),
      }));
    } else if (product.type === 'virtual') {
      detail.virtual = {
        downloadAssetId: product.downloadAssetId ?? null,
        downloadUrl: product.downloadUrl ?? null,
      };
    }

    // Feature 043 — packaging units (only meaningful for the eligible types,
    // which are also the only ones that can have rows).
    if (product.type === 'simple' || product.type === 'configurable') {
      const packagingUnits = await em.find(
        ProductPackagingUnit,
        { productId: product.id },
        { orderBy: { position: 'asc', name: 'asc' } },
      );
      if (packagingUnits.length > 0) {
        detail.packagingUnits = packagingUnits.map((u) => ({
          id: u.id,
          name: u.name,
          baseQuantity: u.baseQuantity,
          position: u.position,
          isDefault: u.isDefault,
        }));
      }
    }

    return detail;
  }

  /**
   * Resolve a batch of products into storefront-shape summaries (id, sku,
   * slug, localized name, primary asset url via gallery thumb chain,
   * price honoring sales-channel public flag). Used by US5 composite
   * eager-load — keeps the per-product fanout to a constant 3-4 queries
   * regardless of how many children/options a parent has.
   */
  private async summariesForIds(
    em: EntityManager,
    ids: string[],
    ctx: CatalogQueryContext,
    channel: CatalogResolvedChannel,
  ): Promise<
    Map<
      string,
      {
        id: string;
        sku: string;
        slug: string;
        name: string;
        primaryAssetUrl: string | null;
        price: { amount: number; currency: string } | null;
      }
    >
  > {
    const result = new Map<string, {
      id: string;
      sku: string;
      slug: string;
      name: string;
      primaryAssetUrl: string | null;
      price: { amount: number; currency: string } | null;
    }>();
    if (ids.length === 0) return result;
    const products = await em.find(Product, { id: { $in: ids } });

    // Primary asset url via gallery thumb chain -> base_image -> first item
    // -> legacy product_assets first row. One helper, shared with `toSummary`
    // and `ProductLinkService`, so the chain and the port call have one home.
    const assetUrlByProduct = await resolvePrimaryAssetUrls(em, this.#requireAssets(), ids);

    const resolvedPrices = await this.#listingPricesFor(products, channel, ctx.audience);
    for (const p of products) {
      const price = this.#summaryPrice(resolvedPrices, p.id);
      result.set(p.id, {
        id: p.id,
        sku: p.sku,
        slug: p.slug,
        name: this.pickLang(p.name, ctx.preferredLanguage, channel),
        primaryAssetUrl: assetUrlByProduct.get(p.id) ?? null,
        price,
      });
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Categories
  // ------------------------------------------------------------------

  async getCategoryTree(ctx: CatalogQueryContext): Promise<CategoryNode[]> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    // Feature 068 — an inactive category is invisible to customers, and so is
    // everything under it: its children never reach `build()` because only
    // roots seed the walk.
    const rows = await em.find(
      Category,
      { deletedAt: null, isActive: true },
      { orderBy: { sortOrder: 'asc' } },
    );

    // Directly-assigned products per category that this caller may see.
    const directSets = await this.directProductSetsByCategory(em, channel, ctx.audience);

    const byParent = new Map<string | null, Category[]>();
    for (const row of rows) {
      const key = row.parentCategoryId ?? null;
      const list = byParent.get(key) ?? [];
      list.push(row);
      byParent.set(key, list);
    }

    // Roll up to a *distinct* product count over each category's whole subtree
    // (self + descendants). A parent category — e.g. the catalog root — would
    // otherwise show 0 because products are assigned to its leaf categories,
    // not to it directly. Counting a Set de-duplicates products that sit in
    // more than one branch of the subtree.
    const subtreeCounts = new Map<string, number>();
    const collectSubtree = (categoryId: string): Set<string> => {
      const acc = new Set<string>(directSets.get(categoryId) ?? []);
      for (const child of byParent.get(categoryId) ?? []) {
        for (const pid of collectSubtree(child.id)) acc.add(pid);
      }
      subtreeCounts.set(categoryId, acc.size);
      return acc;
    };
    for (const root of byParent.get(null) ?? []) collectSubtree(root.id);

    const build = (parentId: string | null): CategoryNode[] => {
      const children = byParent.get(parentId) ?? [];
      return children.map((c) => ({
        id: c.id,
        name: this.pickLang(c.name, ctx.preferredLanguage, channel),
        slug: c.slug,
        sortOrder: c.sortOrder,
        productCount: subtreeCounts.get(c.id) ?? 0,
        children: build(c.id),
      }));
    };
    return build(null);
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------

  async getFilterDefinitions(ctx: CatalogQueryContext): Promise<FilterDefinition[]> {
    const em = this.emFactory();
    const channel = ctx.resolvedChannel;
    const attrs = await this.#requireAttributeRead().listByFlag('isFilterable');

    // Build option / range facets by scanning Products in the channel.
    const products = await em.find(Product, { status: 'active', deletedAt: null });
    const visibleIds = await this.filterByChannel(products.map((p) => p.id), channel);
    // Issue #227 — a facet count is a disclosure too. "Brass (3)" on a
    // catalogue holding two brass products the caller may see is the third
    // one, named by arithmetic.
    const visible = products.filter(
      (p) => visibleIds.has(p.id) && isProductVisibleTo(p, ctx.audience),
    );

    const definitions = attrs.map((a) => {
      const label = this.pickLang(a.label, ctx.preferredLanguage, channel);
      const def: FilterDefinition = {
        attributeKey: a.key,
        label,
        valueType: a.valueType,
        filterPosition: a.filterPosition,
      };
      if (
        a.valueType === 'enum' ||
        a.valueType === 'select' ||
        a.valueType === 'multiselect' ||
        a.valueType === 'boolean' ||
        a.valueType === 'string'
      ) {
        const optionCounts = new Map<string, number>();
        for (const p of visible) {
          const v = p.attributeValues[a.key];
          if (v === undefined || v === null) continue;
          // multiselect carries an array of selected option values.
          if (Array.isArray(v)) {
            for (const item of v) {
              const key = String(item);
              optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
            }
          } else {
            const key = String(v);
            optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
          }
        }
        def.options = Array.from(optionCounts.entries()).map(([value, count]) => ({
          value,
          label: value,
          count,
        }));
      } else if (a.valueType === 'number' || a.valueType === 'price' || a.valueType === 'date') {
        let min: number | undefined;
        let max: number | undefined;
        for (const p of visible) {
          const raw = p.attributeValues[a.key];
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) continue;
          if (min === undefined || n < min) min = n;
          if (max === undefined || n > max) max = n;
        }
        if (min !== undefined && max !== undefined) {
          def.range = { min, max };
        }
      }
      return def;
    });

    // Feature 012 / FR-029 — omit filters that have zero values across
    // every visible product. Option-style filters with an empty options
    // array (no facet hits) are skipped; range-style filters with no
    // resolved min/max are also skipped.
    const nonEmpty = definitions.filter((d) => {
      if (d.options !== undefined) return d.options.length > 0;
      if (d.range !== undefined) return true;
      return false;
    });

    // Feature 055 (US4) — merge Category custom fields flagged `config.filterable`.
    // These are category-level filters whose options come from the field
    // definition, not from a product-facet scan, so they are appended AFTER the
    // product-facet `nonEmpty` drop. The catalog interprets the opaque `config`
    // (FR-006); the generic custom-fields core is unaware of catalog.
    const customFilters = await this.buildCustomFieldFilters(ctx, channel);

    const merged = [...nonEmpty, ...customFilters];

    // Feature 012 / FR-027 + FR-028 — pre-sort by filterPosition ASC,
    // then by resolved label ASC. Storefront consumes the order verbatim.
    merged.sort((a, b) => {
      if (a.filterPosition !== b.filterPosition) return a.filterPosition - b.filterPosition;
      return a.label.localeCompare(b.label);
    });

    return merged;
  }

  /**
   * Feature 055 (US4) — resolve the filterable Category custom fields into
   * {@link FilterDefinition}s. Returns `[]` when no definition source is wired.
   * Select/multiselect fields carry their defined options; scalar fields carry
   * neither options nor range (they render as a keyword/value filter client-side).
   */
  private async buildCustomFieldFilters(
    ctx: CatalogQueryContext,
    channel: CatalogQueryContext['resolvedChannel'],
  ): Promise<FilterDefinition[]> {
    if (!this.customFieldDefinitions) return [];
    const defs = await this.customFieldDefinitions.listForEntity('category');
    const out: FilterDefinition[] = [];
    for (const { definition, options } of defs) {
      if (definition.config?.['filterable'] !== true) continue;
      const label =
        this.pickLang(definition.label, ctx.preferredLanguage, channel) || definition.labelDefault;
      const isSelect = definition.valueType === 'select' || definition.valueType === 'multiselect';
      const def: FilterDefinition = {
        // Namespaced so a custom field cannot collide with a product attribute key.
        attributeKey: `cf.${definition.key}`,
        label,
        valueType: definition.valueType === 'text' ? 'string' : definition.valueType,
        filterPosition: definition.sortOrder,
        ...(isSelect
          ? {
              options: options.map((o) => ({
                value: o.value,
                label:
                  this.pickLang(o.label, ctx.preferredLanguage, channel) || o.labelDefault,
                count: 0,
              })),
            }
          : {}),
      };
      out.push(def);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Feature 012 / FR-030 — build the "Parametry produktu" tab payload
   * for one product. Returns every attribute that meets BOTH:
   *   1. attribute.isVisibleOnProductPage === true
   *   2. product.attributeValues[attribute.key] is non-null + non-empty
   *
   * For select / enum / multiselect types `valueRendered` is the
   * resolved per-locale option label (with fallback to labelDefault);
   * for boolean types it's 'Yes' / 'No'; for number / price / string
   * types it's the value coerced to string.
   *
   * Sorted by AttributeSetAttribute.position when the product has an
   * Attribute Set, else by attribute key ASC for determinism.
   */
  private async buildVisibleAttributesProjection(
    em: EntityManager,
    product: Product,
    preferredLanguage: string | undefined,
    channel: CatalogResolvedChannel,
  ): Promise<Array<{ key: string; label: string; valueType: CatalogAttributeView['valueType']; valueRendered: string }>> {
    const values = product.attributeValues ?? {};
    const valueKeys = Object.keys(values).filter((k) => {
      const v = values[k];
      return v !== undefined && v !== null && v !== '';
    });
    if (valueKeys.length === 0) return [];

    // Feature 061 — attribute metadata + options come from the composed view.
    const valueKeySet = new Set(valueKeys);
    const allViews = await this.#requireAttributeRead().listAll();
    const attrs = allViews.filter((a) => valueKeySet.has(a.key) && a.isVisibleOnProductPage);
    if (attrs.length === 0) return [];

    const optionLabelByAttrAndValue = new Map<
      string,
      Map<string, { label: Record<string, string>; labelDefault: string }>
    >();
    for (const a of attrs) {
      if (a.options.length === 0) continue;
      const bucket = new Map<string, { label: Record<string, string>; labelDefault: string }>();
      for (const o of a.options) {
        bucket.set(o.value, { label: o.label ?? {}, labelDefault: o.labelDefault });
      }
      optionLabelByAttrAndValue.set(a.id, bucket);
    }

    const renderOptionLabel = (attrId: string, value: string): string => {
      const bucket = optionLabelByAttrAndValue.get(attrId);
      const meta = bucket?.get(value);
      if (!meta) return value;
      return this.pickLang(meta.label, preferredLanguage, channel) || meta.labelDefault;
    };

    // Pull the AttributeSetAttribute positions for sort determinism
    // (membership is definition-keyed since feature 061).
    let positionByKey = new Map<string, number>();
    if (product.attributeSetId) {
      const posRows = (await em.execute<
        Array<{ custom_field_definition_id: string; position: number }>
      >(
        `select custom_field_definition_id, position
         from attribute_set_attributes
         where attribute_set_id = ?`,
        [product.attributeSetId],
      )) as Array<{ custom_field_definition_id: string; position: number }>;
      const keyByDefinitionId = new Map(
        allViews.map((v) => [v.customFieldDefinitionId, v.key]),
      );
      positionByKey = new Map(
        posRows
          .map((r) => [keyByDefinitionId.get(r.custom_field_definition_id), r.position] as const)
          .filter((pair): pair is [string, number] => pair[0] !== undefined),
      );
    }

    const items = attrs.map((a) => {
      const raw = values[a.key];
      let valueRendered = '';
      if (Array.isArray(raw)) {
        // multiselect — comma-separated joined option labels
        valueRendered = raw
          .map((item) => renderOptionLabel(a.id, String(item)))
          .filter((s) => s !== '')
          .join(', ');
      } else if (a.valueType === 'select' || a.valueType === 'enum') {
        valueRendered = renderOptionLabel(a.id, String(raw));
      } else if (a.valueType === 'boolean') {
        valueRendered = raw === true || raw === 'true' ? 'Yes' : 'No';
      } else {
        valueRendered = String(raw);
      }
      const label = this.pickLang(a.label, preferredLanguage, channel) || a.labelDefault;
      return {
        key: a.key,
        label,
        valueType: a.valueType,
        valueRendered,
      };
    });

    items.sort((x, y) => {
      const px = positionByKey.get(x.key) ?? Number.MAX_SAFE_INTEGER;
      const py = positionByKey.get(y.key) ?? Number.MAX_SAFE_INTEGER;
      if (px !== py) return px - py;
      return x.key.localeCompare(y.key);
    });

    return items;
  }

  /** Cached per-call list of attribute keys that should match free-text search. */
  private async searchableAttributeKeys(_em: EntityManager): Promise<string[]> {
    const attrs = await this.#requireAttributeRead().listByFlag('isSearchable');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 007 — list of attribute keys flagged `is_comparable=true`,
   * sorted alphabetically. Consumed by the comparisons module's
   * comparison-page projection (`ComparableAttributeProjection`). Public
   * because it crosses a module boundary (Constitution I — comparisons
   * MUST consume catalog through a documented service port, not by
   * importing internals).
   */
  async comparableAttributeKeys(): Promise<string[]> {
    // listByFlag orders by key ASC (legacy parity).
    const attrs = await this.#requireAttributeRead().listByFlag('isComparable');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 012 / US8 — list of attribute keys flagged `is_promo_rule=true`,
   * sorted alphabetically. Consumed by the promotions module's rule-target
   * picker endpoint and by the promotion-rule resolver's skip-on-toggle
   * check (FR-039). Public because it crosses a module boundary
   * (Constitution I — promotions MUST consume catalog through a documented
   * service port, not by importing internals).
   */
  async promoRuleAttributeKeys(): Promise<string[]> {
    // listByFlag orders by key ASC (legacy parity).
    const attrs = await this.#requireAttributeRead().listByFlag('isPromoRule');
    return attrs.map((a) => a.key);
  }

  /**
   * Feature 012 / US8 — load one attribute by key with its option list
   * inline. Returns `null` when the attribute does not exist. The option
   * list is empty for non-select-style types. Used by:
   *   - Promotion-rule editor (criterion picker payload)
   *   - PromotionRuleService.matches() to validate option values
   *     against the attribute's authoritative option set.
   */
  async getAttributeWithOptions(key: string): Promise<{
    id: string;
    key: string;
    label: Record<string, string>;
    labelDefault: string;
    valueType: CatalogAttributeView['valueType'];
    isPromoRule: boolean;
    options: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
  } | null> {
    const attr = await this.#requireAttributeRead().getByIdOrKey(key);
    if (!attr) return null;
    const options = [...attr.options]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
      .map((o) => ({
        value: o.value,
        label: o.label ?? {},
        labelDefault: o.labelDefault,
      }));
    return {
      id: attr.id,
      key: attr.key,
      label: attr.label ?? {},
      labelDefault: attr.labelDefault,
      valueType: attr.valueType,
      isPromoRule: attr.isPromoRule,
      options,
    };
  }

  /**
   * Build a MikroORM where-clause for "attributeValues[key] contains query
   * (case-insensitive)". MikroORM doesn't have a first-class JSONB query
   * helper for the `->>` operator, so we use `$jsonb` style by selecting the
   * value via the operators object.
   */
  private searchableJsonbClause(key: string, query: string): Record<string, unknown> {
    // expr` returns the property at `key` cast to text; ILIKE handles
    // case-insensitivity. We rely on MikroORM's `raw()` operator-form passed
    // through to Knex.
    return { [key]: { $ilike: `%${query}%` } };
  }

  private orderForSort(sort: ListProductsParams['sort']): Record<string, 'asc' | 'desc'> {
    switch (sort) {
      case 'name':
        return { slug: 'asc', id: 'asc' };
      case '-name':
        return { slug: 'desc', id: 'desc' };
      case '-createdAt':
      case 'relevance':
      default:
        return { createdAt: 'desc', id: 'desc' };
    }
  }

  /**
   * The keyset a listing pages by — **derived from the ordering it serves**,
   * never assumed.
   *
   * A chunk is fetched with `orderForSort(sort)` and the walk then asks for
   * "everything after the last row of it". Those are one decision, and they had
   * come apart: the `after` predicate was written over `created_at` whatever the
   * ordering, so under `sort=name` — which orders by `slug` — it excluded the
   * rows *newer* than the last one served instead of the rows already served.
   * That set has no relation to the page, so the walk both repeats products and
   * never reaches the ones between the repeats:
   * `?q=…&sort=name&minPrice=0&maxPrice=100000&limit=3` served
   * `[A, B, A]` on one page and then re-issued a cursor pointing at `B`.
   *
   * Deriving it here is what keeps the two in step for the next ordering
   * somebody adds: `orderForSort` is the only place that says what a sort orders
   * by, and this is the only place that says how to page it.
   */
  private keysetFor(sort: ListProductsParams['sort']): ListingKeyset {
    const order = this.orderForSort(sort);
    const slugDirection = order['slug'];
    if (slugDirection !== undefined) {
      // `slug` is unique, so the `id` tie-break can never fire. It is written
      // anyway because the ordering names it, and a keyset that drops a column
      // its ordering carries is the defect above in miniature.
      const op = slugDirection === 'asc' ? '$gt' : '$lt';
      return {
        of: (product) => ({ slug: product.slug, id: product.id }),
        parse: (decoded) =>
          isRecord(decoded) &&
          typeof decoded['slug'] === 'string' &&
          typeof decoded['id'] === 'string'
            ? { slug: decoded['slug'], id: decoded['id'] }
            : null,
        after: (cursor) => afterKeysetCursor(cursor, op),
      };
    }
    // The default ordering is `createdAt desc, id desc`, in every sort that
    // reaches here, so the direction is not read off the map the way the slug
    // one is — it has nothing to read.
    return {
      of: (product) => ({ createdAt: product.createdAt.toISOString(), id: product.id }),
      parse: (decoded) =>
        isRecord(decoded) &&
        typeof decoded['createdAt'] === 'string' &&
        typeof decoded['id'] === 'string' &&
        !Number.isNaN(new Date(decoded['createdAt']).getTime())
          ? { createdAt: decoded['createdAt'], id: decoded['id'] }
          : null,
      after: (cursor) => afterKeysetCursor(cursor, '$lt'),
    };
  }

  private async filterByChannel(
    productIds: string[],
    channel: CatalogResolvedChannel,
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    // Feature 053 / Principle XII: a channel is ALWAYS resolved, so the catalog
    // constrains to the resolved channel's membership and fails closed to an
    // empty set — never the full cross-channel set. Through the kernel's
    // accessor since issue #185; this was a `select … from
    // sales_channel_products` written here, which is the clause's own
    // counter-example.
    const visible = await this.#requireChannelMembership().filterEntityIdsInChannel(
      channel.id,
      'product',
      productIds,
    );
    return new Set(visible);
  }

  /**
   * Product ids assigned to each requested category **or any of its
   * descendants**, keyed by the requested category id.
   *
   * Exported as a cross-module port (Constitution I): feature 067's feed
   * criteria compiler needs "category membership including descendants"
   * (FR-025) and must not learn the shape of `product_categories` or of the
   * category tree to get it. Unknown or deleted category ids come back as
   * empty sets rather than being dropped, so a criterion naming a deleted
   * category narrows to nothing instead of silently disappearing.
   *
   * No channel scoping here on purpose — the caller applies its own
   * eligibility floor, which for a feed is stricter than the storefront's.
   */
  async expandCategoryProductIds(categoryIds: string[]): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (categoryIds.length === 0) return result;
    const em = this.emFactory();

    const requested = [...new Set(categoryIds)];
    // Descendant ids per requested root (BFS, one query per level for the
    // whole batch — the tree is shallow and this keeps the round trips flat).
    const descendants = new Map<string, string[]>();
    for (const id of requested) descendants.set(id, [id]);

    // Visited set per root. Re-parenting is guarded against cycles
    // (`category-admin.service.ts`), but that guard itself is written to
    // tolerate *pre-existing* cycles in the data, so a corrupted
    // `parent_category_id` chain is reachable here. Without this the loop
    // never terminates: it would re-query the same level forever and grow
    // `descendants` without bound.
    const seen = new Map<string, Set<string>>(requested.map((id) => [id, new Set([id])]));

    let frontier = new Map<string, string[]>(requested.map((id) => [id, [id]]));
    while (frontier.size > 0) {
      const parentIds = [...new Set([...frontier.values()].flat())];
      const children = await em.find(Category, {
        parentCategoryId: { $in: parentIds },
        deletedAt: null,
      });
      if (children.length === 0) break;
      const childrenByParent = new Map<string, string[]>();
      for (const child of children) {
        const parent = String(child.parentCategoryId);
        childrenByParent.set(parent, [...(childrenByParent.get(parent) ?? []), child.id]);
      }
      const next = new Map<string, string[]>();
      for (const [root, level] of frontier) {
        const visited = seen.get(root) ?? new Set<string>();
        const nextLevel = level
          .flatMap((id) => childrenByParent.get(id) ?? [])
          .filter((id) => !visited.has(id));
        if (nextLevel.length === 0) continue;
        for (const id of nextLevel) visited.add(id);
        seen.set(root, visited);
        descendants.set(root, [...(descendants.get(root) ?? []), ...nextLevel]);
        next.set(root, nextLevel);
      }
      frontier = next;
    }

    const allIds = [...new Set([...descendants.values()].flat())];
    const rows = await em.execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories
        where category_id in (${allIds.map(() => '?').join(',')})`,
      allIds,
    );
    const productsByCategory = new Map<string, string[]>();
    for (const row of rows) {
      productsByCategory.set(row.category_id, [
        ...(productsByCategory.get(row.category_id) ?? []),
        row.product_id,
      ]);
    }
    for (const id of requested) {
      const set = new Set<string>();
      for (const categoryId of descendants.get(id) ?? []) {
        for (const productId of productsByCategory.get(categoryId) ?? []) set.add(productId);
      }
      result.set(id, set);
    }
    return result;
  }

  private async productIdsInCategoryTree(
    em: EntityManager,
    categorySlug: string,
  ): Promise<Set<string>> {
    // Feature 068 — an inactive category narrows to nothing, and an inactive
    // branch contributes no products to an active ancestor.
    const root = await em.findOne(Category, {
      slug: categorySlug,
      deletedAt: null,
      isActive: true,
    });
    if (!root) return new Set();

    // Collect descendant ids (BFS).
    const all: string[] = [root.id];
    let frontier: string[] = [root.id];
    while (frontier.length > 0) {
      const children = await em.find(Category, {
        parentCategoryId: { $in: frontier },
        deletedAt: null,
        isActive: true,
      });
      const nextIds = children.map((c) => c.id);
      all.push(...nextIds);
      frontier = nextIds;
    }

    const rows = await em.execute<{ product_id: string }[]>(
      `select product_id from product_categories where category_id in (${all.map(() => '?').join(',')})`,
      all,
    );
    return new Set(rows.map((r) => r.product_id));
  }

  /**
   * Set of channel-visible product ids directly assigned to each category
   * (i.e. via a `product_categories` row). Subtree roll-up to ancestors is
   * done by the caller, which has the parent map to walk.
   */
  private async directProductSetsByCategory(
    em: EntityManager,
    channel: CatalogResolvedChannel,
    audience: ProductAudience,
  ): Promise<Map<string, Set<string>>> {
    const base = await em.execute<{ category_id: string; product_id: string }[]>(
      `select category_id, product_id from product_categories`,
    );
    if (base.length === 0) return new Map();

    // Channel membership.
    const visibleIds = await this.filterByChannel(
      base.map((r) => r.product_id),
      channel,
    );
    // Issue #227 — and the audience axis, which needs the two columns this
    // path never loaded: `product_categories` carries ids and nothing else, so
    // the rows come back here rather than the predicate going down there. The
    // category tree publishes a `productCount` per node, and a count is the
    // one field a restricted product can still move.
    const restricted = new Set(
      (
        await em.find(
          Product,
          { id: { $in: [...visibleIds] } },
          { fields: ['id', 'visibility', 'allowedOrganizationIds'] },
        )
      )
        .filter((p) => !isProductVisibleTo(p, audience))
        .map((p) => p.id),
    );
    const sets = new Map<string, Set<string>>();
    for (const row of base) {
      if (!visibleIds.has(row.product_id)) continue;
      if (restricted.has(row.product_id)) continue;
      let set = sets.get(row.category_id);
      if (!set) {
        set = new Set<string>();
        sets.set(row.category_id, set);
      }
      set.add(row.product_id);
    }
    return sets;
  }

  /**
   * One product's listing summary.
   *
   * Every input is the **page's**, resolved by the caller, and all of them are
   * required rather than optional. This method used to resolve its own price,
   * its own primary asset and its own category slugs, which meant every listing
   * path that mapped over a page paid all three once per card — 150 of the ~158
   * statements a 50-item page cost after the price was hoisted (issue #263).
   * Making the parameters mandatory is what stops the next caller from quietly
   * re-opening that.
   *
   * It takes no `EntityManager` and is synchronous for the same reason: with
   * nothing to query through and nothing to await, a per-card read cannot be
   * added back here without the change being the point of the diff.
   */
  private toSummary(
    product: Product,
    channel: CatalogResolvedChannel,
    preferredLanguage: string | undefined,
    resolvedPrices: Map<string, ListingPrice>,
    cardReads: ListingCardReads,
  ): ProductSummary {
    // Price — the pricing engine's answer for this product on this channel
    // (issue #132), read out of the page's resolution. Sales Channel visibility
    // still strips it on a non-public channel; what changed is that the figure
    // underneath is one a price list stands behind rather than the catalogue's
    // own legacy attribute.
    const price = this.#summaryPrice(resolvedPrices, product.id);

    const nameText = this.pickLang(product.name, preferredLanguage, channel);

    return {
      id: product.id,
      sku: product.sku,
      type: product.type,
      name: nameText,
      slug: product.slug,
      categorySlugs: cardReads.categorySlugsByProduct.get(product.id) ?? [],
      primaryAssetUrl: cardReads.assetUrlByProduct.get(product.id) ?? null,
      price,
      stockIndicator: null,
      stockLevel: null,
    };
  }

  private pickLang(
    blob: Record<string, string>,
    preferred?: string,
    channel?: CatalogResolvedChannel,
  ): string {
    const preferredLangs = [preferred, channel?.defaultLanguage, 'en-US', 'en'].filter(
      (v): v is string => typeof v === 'string',
    );
    for (const lang of preferredLangs) {
      const hit = blob[lang];
      if (hit) return hit;
    }
    const anyKey = Object.keys(blob)[0];
    return anyKey ? (blob[anyKey] ?? '') : '';
  }

  private coerceAttributeValues(v: Record<string, unknown>): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        out[k] = val;
      } else if (val !== null && val !== undefined) {
        out[k] = String(val);
      }
    }
    return out;
  }
}
