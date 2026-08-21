import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  listingPriceMoney,
  type CatalogAttributeReadPort,
  type CatalogGalleryPort,
  type CatalogProductReadPort,
  ANONYMOUS_PRODUCT_AUDIENCE,
  isProductVisibleTo,
  type ComparisonOwnerView,
  type ComparisonDisplayMode,
  type ComparisonPricedFor,
  type ListingPrice,
  type ListingPricePort,
  type OrganizationDetailsPort,
  type PriceOrganization,
  type ProductAudience,
} from '@b2b/contracts';
import { withSystemScope } from '../../../tenancy/index.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { SalesChannelMembershipPort } from '../../../kernel/ports/sales-channel.js';
import type { SettingsService } from '../../../kernel/settings/settings.service.js';
import { Comparison } from '../entities/comparison.entity.js';
import { ComparisonProduct } from '../entities/comparison-product.entity.js';
import type { ShareTokenGenerator } from './share-token-generator.js';
import type { ComparableAttributeProjection } from './comparable-attribute-projection.js';
import {
  COMPARE_SETTING_CODES,
  DEFAULT_COMPARE_MAX_PRODUCTS,
} from '../manifest.js';

/**
 * ComparisonService — feature 007 / T023 + T024.
 *
 * Stateful service owning the Comparison resource. Every cross-module read
 * goes through a published port — {@link CatalogProductReadPort},
 * {@link CatalogAttributeReadPort}, {@link ListingPricePort} and
 * {@link SettingsService}. The products a comparison holds are `catalog`'s
 * rows, not this module's: reading them with `em.find(Product, …)` was a query
 * nothing could gate, so a comparison kept resolving names and availability
 * out of a module an operator had switched off (feature 075, Phase C).
 *
 * Behaviour summary (per `data-model.md`, `research.md`, and
 * `contracts/public-comparisons-crud.md`):
 *
 *   - `getForOwner` returns the caller's live Comparison or `null`. No
 *     side effects.
 *   - `addProduct` enforces `compare.max_products` on add (R-7). Throws
 *     {@link ComparisonFullError} when the cap would be exceeded.
 *     Idempotent on duplicates: re-adding a product already in the set
 *     is a no-op that returns the current comparison.
 *   - `removeProduct` throws {@link ProductNotInComparisonError} when
 *     the product is not in the set; emptying the set is allowed.
 *   - `setDisplayMode` only updates the persisted mode; refuses with
 *     {@link ComparisonNotFoundError} when the caller has no comparison.
 *   - `deleteForOwner` hard-deletes; cascades onto `comparison_products`
 *     by FK. Invalidates the share token (the row is gone — the share
 *     endpoint will return 404).
 *   - `findByShareToken` resolves the token in O(1) via the UNIQUE
 *     index. Used in US2 for the recipient view.
 *   - `buildOwnerView` produces the on-the-wire shape for `GET /me`
 *     (and is reused for the share-token recipient view in US2 and the
 *     admin detail view in US5).
 */
/**
 * Who is reading a comparison.
 *
 * Two kinds rather than one `ProductAudience`, because an administrator is not
 * a buyer and there is no audience that means "may see everything": the
 * predicate in {@link isProductVisibleTo} answers for a *shopper*, and every
 * audience an administrator could be given would drop the organisation-
 * restricted rows the audit screen exists to show. Making that an explicit
 * kind is what keeps it from being expressed as a permissive audience
 * somebody later reuses on a storefront path.
 */
export type ComparisonViewer =
  | { readonly kind: 'buyer'; readonly audience: ProductAudience }
  | { readonly kind: 'administrator' };

/**
 * The most restrictive viewer there is — the public. The right default for a
 * caller that has not been taught to resolve its reader, for the same reason
 * {@link ANONYMOUS_PRODUCT_AUDIENCE} is: everything it may see, every other
 * viewer may see too.
 */
export const ANONYMOUS_COMPARISON_VIEWER: ComparisonViewer = {
  kind: 'buyer',
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
};

export class ComparisonService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly projection: ComparableAttributeProjection,
    private readonly tokens: ShareTokenGenerator,
    /**
     * `catalog`'s product read model. Not optional: a comparison is a list of
     * products, so a service that cannot read one has nothing to answer with —
     * where the settings and pricing arguments below have a defined fallback,
     * this has none.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * The sanctioned bridge accessor (Constitution XII), for the assortment
     * gate `addProduct` owes (issue #259). Required for the same reason
     * `catalogProducts` is: an optional one would spell "this rig wired no
     * membership service" and "this channel publishes the product" as the same
     * answer.
     */
    private readonly channelMembership: SalesChannelMembershipPort,
    /**
     * Feature 075 / D-87 — `catalog`'s gallery read model, for the base image
     * of each column. Required for the same reason `catalogProducts` is: the
     * alternative to a wired port is not "a comparison without pictures", it is
     * a service that cannot tell an operator who set no base image from a rig
     * that wired no owner.
     *
     * `baseImageUrls`, not `list`: the read is a batch, it must tolerate an id
     * whose product has since been removed, and the value a column renders is a
     * **url**, which `catalog` resolves through the asset port it holds. Those
     * three are exactly why the single join this replaced could not be swapped
     * for the per-product port that already existed.
     */
    private readonly catalogGallery: CatalogGalleryPort,
    /**
     * Optional settings service. When undefined, `compare.max_products`
     * defaults to {@link DEFAULT_COMPARE_MAX_PRODUCTS} on every call —
     * useful for foundation tests that pre-date Settings wiring.
     */
    private readonly settingsService?: SettingsService,
    /**
     * Feature 061 — the catalog's composed attribute read model (Principle I:
     * replaces the former direct `ProductAttribute` entity find).
     */
    private readonly catalogAttributes?: CatalogAttributeReadPort,
    /**
     * Issue #132 — the pricing engine, through the `pricingService` port. A
     * comparison exists so a buyer can put prices side by side, so the figures
     * in its columns have to be the ones a price list stands behind.
     */
    private readonly listingPrices?: ListingPricePort,
    /**
     * `organizations`' read model, for the one field the pricing engine needs
     * beyond the viewer's organisation id: the customer group it belongs to,
     * which a group-targeted price list is selected by. Without it a buyer's
     * comparison column and their own cart line would resolve against
     * different lists and quote different figures for one product.
     */
    private readonly organizationDetails?: OrganizationDetailsPort,
  ) {}

  #requireListingPrices(): ListingPricePort {
    if (!this.listingPrices) {
      throw new Error(
        'ComparisonService: the pricing port is not wired — a comparison cannot be priced.',
      );
    }
    return this.listingPrices;
  }

  #requireOrganizationDetails(): OrganizationDetailsPort {
    if (!this.organizationDetails) {
      throw new Error(
        'ComparisonService: the organization read port is not wired — a signed-in buyer cannot be priced.',
      );
    }
    return this.organizationDetails;
  }

  /**
   * The buying organisation the pricing engine should resolve against, for the
   * viewer in front of this comparison — or `null` when there is none, which is
   * the anonymous reader, the signed-in buyer whose account carries no
   * Organization, and the buyer whose organisation has since been removed.
   *
   * The last of those three deserves saying: it answers with the channel price
   * rather than throwing, and the view says `pricedFor: 'channel'`, so a figure
   * is never labelled as the reader's own when it is not.
   */
  async #viewerOrganization(viewer: ProductAudience): Promise<PriceOrganization | null> {
    if (viewer.organizationId === null) return null;
    const record = await this.#requireOrganizationDetails().findById(viewer.organizationId);
    if (!record) return null;
    return { id: record.id, customerGroupId: record.customerGroupId };
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async getForOwner(owner: ComparisonOwner): Promise<Comparison | null> {
    const em = this.emFactory();
    return em.findOne(Comparison, ownerWhere(owner));
  }

  /**
   * Resolve a share token to its comparison, across customers.
   *
   * `Comparison` is `@CustomerScoped`, so the ambient filter confines this read
   * to the caller's own rows — which is right for every other method here and
   * is the one thing a share link has to cross. An **anonymous** recipient
   * already crossed it by accident: the composition roots run anonymous
   * requests under `systemTenantContext('actor:anonymous')`, so the filter is a
   * no-op for them, while a *signed-in* recipient got a 404 on a link that
   * worked when they were logged out. That is the shape a guard takes when a
   * deliberate cross-tenant grant is left implicit.
   *
   * So it is explicit, through the one sanctioned crossing (feature 050,
   * FR-005): the token is the authorization, exactly as it is on the public
   * product-feed endpoint, and the widening covers this single lookup by a
   * unique index and nothing after it. **What the recipient then sees is not
   * widened at all** — `buildOwnerView` filters the products by their own
   * audience and prices them for their own organisation.
   */
  async findByShareToken(token: string): Promise<Comparison | null> {
    const em = this.emFactory();
    return withSystemScope(
      'comparisons: share-token lookup — a share link is a cross-customer grant, and the token is the authorization',
      async () => em.findOne(Comparison, { shareToken: token }),
    );
  }

  /**
   * Anonymous → authenticated merge (research.md R-2 / spec FR-005).
   * Called from the post-login hook with the cookie-bound
   * `anonymousToken` the caller was carrying. Behaviour:
   *
   *   - customer has no Comparison → reassign the anonymous one
   *     (set customer_account_id, clear anonymous_token).
   *   - customer already has a Comparison → discard the anonymous one
   *     (the customer's existing curated set wins, per R-2 — merging
   *     two sets is more surprising than honouring the persistent
   *     identity).
   *
   * No-op when neither side resolves.
   */
  async adoptAnonymousComparison(
    customerAccountId: string,
    anonymousToken: string,
  ): Promise<void> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();
    const anon = await em.findOne(Comparison, { anonymousToken });
    if (!anon) return;

    const existing = await em.findOne(Comparison, { customerAccountId });
    if (existing) {
      await em.removeAndFlush(anon);
      return;
    }

    anon.customerAccountId = customerAccountId;
    anon.anonymousToken = null;
    anon.updatedAt = new Date();
    await em.flush();
  }

  /**
   * True when the supplied owner identity matches the Comparison's
   * stored owner. Used by the share-token endpoint to populate
   * `meta.viewerIsOwner`.
   */
  isOwnedBy(comparison: Comparison, owner: ComparisonOwner | null): boolean {
    if (!owner) return false;
    if (owner.kind === 'customer') {
      return comparison.customerAccountId === owner.customerAccountId;
    }
    return comparison.anonymousToken === owner.anonymousToken;
  }

  // ------------------------------------------------------------------
  // Writes
  // ------------------------------------------------------------------

  async addProduct(
    owner: ComparisonOwner,
    salesChannelId: string,
    productId: string,
    /**
     * Who is comparing (issue #227). Defaulted to the anonymous audience so a
     * composition that has not been taught to resolve its caller refuses a
     * restricted product rather than adding it — the fail-closed end. The
     * public route passes the real one.
     */
    audience: ProductAudience = ANONYMOUS_PRODUCT_AUDIENCE,
  ): Promise<Comparison> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();

    const product = await this.catalogProducts.findById(productId);
    // Issue #227 — a comparison row discloses the product's name, SKU, price
    // and every comparable attribute value, so a product this shopper may not
    // see may not enter their comparison. Same answer as a product that does
    // not exist: `ProductNotFoundError` is what the route turns into a 404.
    if (!product || !isProductVisibleTo(product, audience)) {
      throw new ProductNotFoundError(productId);
    }
    // Issue #259 — the channel axis, which the predicate above states in
    // writing that it is not. `salesChannelId` is the channel the caller
    // resolved for this request and stamps on the row below, so the comparison
    // a buyer builds on one channel can only ever hold products that channel
    // publishes. Same `ProductNotFoundError` as the line above: "sold on
    // another channel" must be indistinguishable from "restricted" and from
    // "does not exist", or the three together enumerate the assortment.
    const publishedHere = await this.channelMembership.filterEntityIdsInChannel(
      salesChannelId,
      'product',
      [product.id],
    );
    if (publishedHere.length === 0) {
      throw new ProductNotFoundError(productId);
    }

    let comparison = await em.findOne(Comparison, ownerWhere(owner));
    if (!comparison) {
      comparison = em.create(Comparison, {
        shareToken: this.tokens.generate(),
        ...ownerColumns(owner),
        salesChannelId,
        displayMode: 'all' as ComparisonDisplayMode,
      });
      await em.persistAndFlush(comparison);
    }

    const existingRows = await em.find(ComparisonProduct, {
      comparisonId: comparison.id,
    });
    // Idempotent on duplicate add — caller's earlier click is honoured.
    if (existingRows.some((r) => r.productId === productId)) {
      return comparison;
    }

    const max = await this.resolveMaxProducts(salesChannelId);
    if (existingRows.length >= max) {
      throw new ComparisonFullError(max);
    }

    const next = em.create(ComparisonProduct, {
      comparisonId: comparison.id,
      productId,
      position: existingRows.length,
    });
    comparison.updatedAt = new Date();
    await em.persistAndFlush(next);
    return comparison;
  }

  async removeProduct(owner: ComparisonOwner, productId: string): Promise<Comparison> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();
    const comparison = await em.findOne(Comparison, ownerWhere(owner));
    if (!comparison) throw new ComparisonNotFoundError();
    const row = await em.findOne(ComparisonProduct, {
      comparisonId: comparison.id,
      productId,
    });
    if (!row) throw new ProductNotInComparisonError(productId);
    await em.removeAndFlush(row);
    comparison.updatedAt = new Date();
    await em.flush();
    return comparison;
  }

  async setDisplayMode(
    owner: ComparisonOwner,
    mode: ComparisonDisplayMode,
  ): Promise<Comparison> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();
    const comparison = await em.findOne(Comparison, ownerWhere(owner));
    if (!comparison) throw new ComparisonNotFoundError();
    comparison.displayMode = mode;
    comparison.updatedAt = new Date();
    await em.flush();
    return comparison;
  }

  async deleteForOwner(owner: ComparisonOwner): Promise<void> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();
    const comparison = await em.findOne(Comparison, ownerWhere(owner));
    if (!comparison) throw new ComparisonNotFoundError();
    // FK on comparison_products cascades; we can simply remove the row.
    await em.removeAndFlush(comparison);
  }

  // ------------------------------------------------------------------
  // Read-side projection (consumed by GET /me + US2 share + US5 admin)
  // ------------------------------------------------------------------

  /**
   * Build the wire-format `ComparisonOwnerView` for the given comparison
   * in the viewer's sales-channel context. Reusable across the three
   * consumers (owner / recipient / admin); the recipient + admin views
   * pass `viewerIsOwner=false` and consume only the slice they need.
   *
   * **The viewer's identity decides what the viewer sees. Always.** A share
   * token grants access to the *comparison*, never to anything in it, so it
   * settles two questions the same way:
   *
   *  - **the prices** — the owner sees their organisation's figures, a
   *    signed-in recipient from another organisation sees **theirs**, and an
   *    anonymous recipient sees the channel's. That is what makes a shared
   *    link trustworthy: the numbers are true for whoever is looking, and a
   *    recipient who acted on the sender's negotiated price would be acting on
   *    a price nobody will sell them at.
   *  - **the products** — a row restricted to the sender's organisation is not
   *    disclosed to a recipient outside it, while a recipient who *is* on the
   *    allow-list sees it. The owner was entitled to add it (`addProduct`
   *    enforces that, issue #227); a second reader has an entitlement of their
   *    own, and a product may be restricted after it was added.
   *
   * The two run in that order — filter, then price — because a price resolved
   * for a row the reader may not see is work done to produce a figure that must
   * not be sent.
   */
  async buildOwnerView(
    comparison: Comparison,
    viewerSalesChannelId: string,
    /**
     * Who is looking. Defaulted to the anonymous buyer so a caller that has not
     * been taught to resolve its reader shows the public set at the channel
     * price — the answer every reader may see — rather than one buyer's.
     */
    viewer: ComparisonViewer = ANONYMOUS_COMPARISON_VIEWER,
  ): Promise<ComparisonOwnerView> {
    const em = this.emFactory();

    const bridgeRows = await em.find(
      ComparisonProduct,
      { comparisonId: comparison.id },
      { orderBy: { position: 'asc', addedAt: 'asc' } },
    );

    const productIds = bridgeRows.map((r) => r.productId);
    const stored =
      productIds.length > 0 ? await this.catalogProducts.findByIds(productIds) : [];
    // Issue #227's predicate, over this reader. A product the reader may not
    // see leaves the view entirely — it is not a `(removed product)` column,
    // which would disclose that the sender holds something.
    const products =
      viewer.kind === 'administrator'
        ? stored
        : stored.filter((product) => isProductVisibleTo(product, viewer.audience));
    const hiddenProductCount = stored.length - products.length;
    const productById = new Map(products.map((p) => [p.id, p]));

    const channel = await em.findOne(SalesChannel, { id: viewerSalesChannelId });
    const currency = channel?.defaultCurrency ?? 'PLN';
    const isPublic = channel?.isPublic ?? true;

    const viewerOrganization =
      viewer.kind === 'buyer' ? await this.#viewerOrganization(viewer.audience) : null;

    // The pricing engine's answer per product (issue #132), resolved for the
    // viewer. A channel that withholds prices is not asked for them, so the map
    // stays empty and every column renders `null`.
    const resolvedPrices =
      isPublic && products.length > 0
        ? await this.#requireListingPrices().resolveListingPrices({
            products,
            context: {
              salesChannel: { id: viewerSalesChannelId, defaultCurrency: currency },
              organization: viewerOrganization,
            },
          })
        : new Map<string, ListingPrice>();
    const pricedFor: ComparisonPricedFor =
      viewerOrganization !== null ? 'organization' : 'channel';

    // Base-image lookup per product (label='base_image' only — spec FR-006
    // names *base image* explicitly; no fallback to other labels, which is why
    // `catalog`'s own `resolvePrimaryAssetUrls` — thumbnail → base_image →
    // first — is not what this asks for).
    //
    // Feature 075 / D-87: this was one statement joining `gallery_item_labels`
    // and `gallery_items` to `assets_library`'s `assets`, three cross-module
    // reaches in a single join and invisible to every import check in the tree.
    // The owner answers it now, from its own two tables plus the asset port it
    // already holds.
    const visibleProductIds = products.map((p) => p.id);
    const baseImageByProduct =
      visibleProductIds.length > 0
        ? await this.catalogGallery.baseImageUrls(visibleProductIds)
        : new Map<string, string | null>();

    // Comparable attribute definitions (catalog adapter port — Constitution I).
    // `listByFlag` orders by key ASC, matching the pre-061 entity query.
    const attributeDefs = this.catalogAttributes
      ? await this.catalogAttributes.listByFlag('isComparable')
      : [];

    // A row this reader may not see is dropped; a row whose product is *gone*
    // still renders as `(removed product)`, which is the owner's own history
    // and says nothing about anybody's entitlement.
    const withheldIds = new Set(
      stored.filter((p) => !productById.has(p.id)).map((p) => p.id),
    );
    const visibleRows = bridgeRows.filter((row) => !withheldIds.has(row.productId));
    const productSummaries = visibleRows.map((row) => {
      const p = productById.get(row.productId);
      if (!p) {
        return {
          id: row.productId,
          sku: '',
          name: { en: '(removed product)' },
          slug: '',
          type: 'simple' as const,
          primaryAssetUrl: null,
          price: null,
          available: false,
          addedAt: row.addedAt.toISOString(),
        };
      }
      const resolved = resolvedPrices.get(p.id);
      const price = resolved === undefined ? null : listingPriceMoney(resolved);
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        slug: p.slug,
        type: p.type,
        primaryAssetUrl: baseImageByProduct.get(p.id) ?? null,
        price,
        available:
          p.deletedAt == null && p.archivedAt == null && p.status === 'active',
        addedAt: row.addedAt.toISOString(),
      };
    });

    const comparableAttributes = this.projection.projectRows(
      productSummaries.map((s) => {
        const p = productById.get(s.id);
        return { attributeValues: p?.attributeValues ?? {} };
      }),
      attributeDefs,
    );

    const max = await this.resolveMaxProducts(viewerSalesChannelId);

    return {
      id: comparison.id,
      shareToken: comparison.shareToken,
      displayMode: comparison.displayMode,
      maxProducts: max,
      products: productSummaries,
      comparableAttributes,
      pricedFor,
      hiddenProductCount,
      createdAt: comparison.createdAt.toISOString(),
      updatedAt: comparison.updatedAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /**
   * Read `compare.max_products` from Settings; fall back to the manifest
   * default on any error (Settings hiccup must not break the storefront).
   */
  private async resolveMaxProducts(salesChannelId: string): Promise<number> {
    if (!this.settingsService) return DEFAULT_COMPARE_MAX_PRODUCTS;
    try {
      const value = await this.settingsService.get(
        COMPARE_SETTING_CODES.MAX_PRODUCTS,
        salesChannelId,
        z.number().int().positive(),
      );
      // Defensive bounds — operator could set anything via CLI; the
      // service still must not allow zero or negative caps.
      return Math.max(1, Math.floor(value));
    } catch {
      return DEFAULT_COMPARE_MAX_PRODUCTS;
    }
  }

}

// ---------------------------------------------------------------------------
// Owner discriminated union + WHERE helpers
// ---------------------------------------------------------------------------

export type ComparisonOwner =
  | { kind: 'customer'; customerAccountId: string }
  | { kind: 'anonymous'; anonymousToken: string };

function ownerWhere(owner: ComparisonOwner): Record<string, unknown> {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId }
    : { anonymousToken: owner.anonymousToken };
}

function ownerColumns(owner: ComparisonOwner): {
  customerAccountId: string | null;
  anonymousToken: string | null;
} {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId, anonymousToken: null }
    : { customerAccountId: null, anonymousToken: owner.anonymousToken };
}

// ---------------------------------------------------------------------------
// Typed exceptions — translated to HTTP status codes by routes.public.ts.
// ---------------------------------------------------------------------------

export class ComparisonFullError extends Error {
  constructor(public readonly max: number) {
    super(`Comparison already holds the maximum of ${max} products.`);
    this.name = 'ComparisonFullError';
  }
}

export class ComparisonNotFoundError extends Error {
  constructor() {
    super('Comparison not found.');
    this.name = 'ComparisonNotFoundError';
  }
}

export class ProductNotInComparisonError extends Error {
  constructor(public readonly productId: string) {
    super(`Product ${productId} is not in the comparison.`);
    this.name = 'ProductNotInComparisonError';
  }
}

export class ProductNotFoundError extends Error {
  constructor(public readonly productId: string) {
    super(`Product ${productId} not found.`);
    this.name = 'ProductNotFoundError';
  }
}
