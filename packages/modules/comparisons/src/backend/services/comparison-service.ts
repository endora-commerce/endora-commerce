import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  listingPriceMoney,
  type CatalogAttributeReadPort,
  type CatalogGalleryPort,
  type CatalogProductAvailabilityPort,
  type CatalogProductUrlKeyReadPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  ANONYMOUS_PRODUCT_AUDIENCE,
  isOrderMinimumEligibleType,
  isProductVisibleTo,
  scopeLanguageOf,
  effectiveScopedValue,
  effectiveSystemText,
  type ScopeLevel,
  type OverrideRow,
  type ComparisonOwnerView,
  type ComparisonDisplayMode,
  type ComparisonPricedFor,
  type CustomerAccountReadPort,
  type ListingPrice,
  type ListingPricePort,
  type OrganizationDetailsPort,
  type PriceOrganization,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { SalesChannel, currentSalesChannel } from '@endora-commerce/platform/kernel';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { Comparison } from '../entities/comparison.entity.js';
import { ComparisonProduct } from '../entities/comparison-product.entity.js';
import type { ShareTokenGenerator } from './share-token-generator.js';
import type { ComparableAttributeProjection } from './comparable-attribute-projection.js';
import {
  COMPARE_SETTING_CODES,
  DEFAULT_COMPARE_MAX_PRODUCTS,
} from '../../manifest.js';

/**
 * ComparisonService — feature 007 / T023 + T024.
 *
 * Stateful service owning the Comparison resource. Every cross-module read
 * goes through a published port — {@link CatalogProductReadPort},
 * {@link CatalogAttributeReadPort}, {@link ListingPricePort} and
 * {@link SettingsReadPort}. The products a comparison holds are `catalog`'s
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
/**
 * Feature 163, owner decision CMP-1 = A — whether a view's reader is the comparison's
 * owner (the `/me` routes, the owner opening their own share link, the owner's PDF,
 * and the operator's audit screen) or anybody else (a share-link recipient).
 */
export type ComparisonReader = 'owner' | 'recipient';

export type ComparisonViewer =
  | {
      readonly kind: 'buyer';
      readonly audience: ProductAudience;
      /** Feature 163 — the request's language tag; L is it resolved against the channel. */
      readonly languageTag?: string;
    }
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
     * Feature 163 — `catalog`'s one answer to "may this reader acquire this
     * product here, now" (FR-004): membership through the sanctioned bridge
     * accessor (Constitution XII, issue #259), effective status at (channel,
     * L), window and effective audience. Required for the same reason
     * `catalogProducts` is: an optional one would spell "this rig wired
     * nothing" and "this channel offers the product" as the same answer.
     */
    private readonly availability: Pick<
      CatalogProductAvailabilityPort,
      'filterAvailable' | 'effectiveOrderRules' | 'describeChannelAvailability'
    >,
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
    private readonly settingsService?: SettingsReadPort,
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
    /**
     * Feature 087 Group B / D-187 — `customer_accounts`' read model, for the
     * one field the owner stamp needs: the organisation the owning account
     * belongs to.
     *
     * The organisation is derived from the **row**, never from the ambient
     * request context, and that is what makes one implementation serve both
     * write paths: `addProduct` runs on a storefront request and
     * `adoptAnonymousComparison` runs inside another module's login hook, where
     * there is no comparison caller to read a context from.
     *
     * Optional in the constructor and required at the two call sites, in the
     * shape {@link organizationDetails} already takes here. A rig that wired no
     * port cannot stamp, and the honest answer to that is a refusal at the
     * write rather than a row `comparisons_organization_attribution_chk` will
     * reject with a message about a constraint the caller never heard of.
     */
    private readonly customerAccounts?: CustomerAccountReadPort,
    /**
     * Feature 163 (T113a, R28) — the effective URL key per channel language, so a
     * column links to the key that resolves at the reader's (channel, language).
     * Absent (a rig that wires none), a column keeps the global key.
     */
    private readonly urlKeys?: Pick<CatalogProductUrlKeyReadPort, 'effectiveKeys'>,
  ) {}

  /**
   * Feature 163 (FR-017 c) — each column's Name and compared values at
   * (`channelId`, `languageCode`): the channel's override where #384's walk
   * lands on one, else the stored value. The Name stays a per-language record —
   * its entry for `languageCode` is the effective one — so a reader that picks
   * its language out of it reads what the storefront shows.
   */
  async #effectiveValues(
    products: readonly CatalogProductRecord[],
    channelId: string,
    languageCode: string | null,
    _channelDefaultLanguage: string | undefined,
    attributeDefs: ReadonlyArray<{ key: string; scopeLevels?: readonly ScopeLevel[] }>,
  ): Promise<{ names: Map<string, string>; values: Map<string, Record<string, unknown>> }> {
    // Feature 168 — the chain at (C, L): C×L → C → Global (`contracts/readers.md` §1).
    const names = new Map<string, string>();
    const values = new Map<string, Record<string, unknown>>();
    if (products.length === 0 || languageCode === null) return { names, values };
    const rows = await this.catalogProducts.listValueOverridesByProductIds(
      products.map((p) => p.id),
      { channelId },
    );
    if (rows.length === 0) return { names, values };
    const byProduct = new Map<string, OverrideRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.productId) ?? [];
      list.push({ attributeKey: row.attributeKey, channelId: row.channelId, languageCode: row.languageCode, value: row.value });
      byProduct.set(row.productId, list);
    }
    const ctx = { channelId, languageCode };
    for (const product of products) {
      const overrides = byProduct.get(product.id);
      if (!overrides) continue;
      names.set(product.id, effectiveSystemText(overrides, 'name', ctx, product.name) ?? product.name);
      const out: Record<string, unknown> = { ...product.attributeValues };
      for (const def of attributeDefs) {
        out[def.key] = effectiveScopedValue(overrides, def.key, def.scopeLevels ?? ['G'], ctx, product.attributeValues[def.key]);
      }
      values.set(product.id, out);
    }
    return { names, values };
  }

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
   * The organisation that owns a comparison belonging to this account — feature
   * 087 Group B, D-187.
   *
   * Total, and refuses rather than returning `null`: `customer_accounts.organization_id`
   * is `NOT NULL` (D-178), so an account that resolves always has one, and an
   * account that does not resolve is a caller naming a row that is not there.
   * Either way there is no organisation to stamp, and a comparison written
   * without one is a row hidden from the representative who serves its buyer —
   * which is the whole defect this column exists to close. So the write stops
   * here, where the message can name the account, instead of at the constraint.
   */
  async #organizationOf(customerAccountId: string): Promise<string> {
    if (!this.customerAccounts) {
      throw new Error(
        'ComparisonService: the customer-account read port is not wired — an owned comparison cannot be attributed to an organisation.',
      );
    }
    const account = await this.customerAccounts.findById(customerAccountId);
    if (!account) {
      throw new Error(
        `ComparisonService: customer account ${customerAccountId} does not resolve, so the comparison it would own has no organisation to carry.`,
      );
    }
    return account.organizationId;
  }

  /**
   * The owner identity a row can be written from — the caller's, plus the
   * organisation a customer owner's account belongs to (D-187).
   */
  async #resolveOwner(owner: ComparisonOwner): Promise<ResolvedComparisonOwner> {
    if (owner.kind === 'anonymous') return owner;
    return {
      kind: 'customer',
      customerAccountId: owner.customerAccountId,
      organizationId: await this.#organizationOf(owner.customerAccountId),
    };
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
   *
   * **This is the one place in the platform where a comparison becomes owned**
   * — `Cart` has no counterpart, because its anonymous merge *completes* the
   * anonymous cart rather than re-owning it. So it is the write feature 087's
   * invariant would have been forgotten at: the row arrives here with a null
   * `organization_id` that was correct while it was anonymous, and the
   * organisation is set in the same unit of work as the account, from the same
   * account. Nothing here is conditional on the column being null — an
   * anonymous row's organisation is null by construction, and if it ever is
   * not, the account it is being handed to is the truth.
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

    // D-187 — resolved **before** the row is touched, not between the account
    // and the flush. The entity is managed, so a throw after the assignment
    // would leave an owned, unattributed comparison in the unit of work for
    // whatever flushes this request next.
    const organizationId = await this.#organizationOf(customerAccountId);

    anon.customerAccountId = customerAccountId;
    anon.organizationId = organizationId;
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
    /** Feature 163 — the request's language tag (L is it resolved against the channel). */
    languageTag?: string,
  ): Promise<Comparison> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();

    const product = await this.catalogProducts.findById(productId);
    // Issue #227 — a comparison row discloses the product's name, SKU, price
    // and every comparable attribute value, so a product this shopper may not
    // see may not enter their comparison. Same answer as a product that does
    // not exist: `ProductNotFoundError` is what the route turns into a 404.
    if (!product) throw new ProductNotFoundError(productId);
    // Issues #227, #259 and feature 163 — the channel, its language, the
    // window and the audience in one answer from `catalog`. `salesChannelId`
    // is the channel the caller resolved for this request and stamps on the
    // row below, so the comparison a buyer builds on one channel can only ever
    // hold products available there. Same `ProductNotFoundError` for every
    // reason: "sold on another channel", "switched off", "restricted" and
    // "does not exist" must be indistinguishable, or together they enumerate
    // the assortment.
    const available = await this.availability.filterAvailable([product.id], {
      channelId: salesChannelId,
      languageCode: comparisonScopeLanguage(salesChannelId, languageTag),
      audience,
    });
    if (!available.has(product.id)) throw new ProductNotFoundError(productId);

    let comparison = await em.findOne(Comparison, ownerWhere(owner));
    if (!comparison) {
      // D-187 — the only place a comparison is inserted, and the organisation
      // goes in with the account. `ownerColumns` takes a *resolved* owner, so
      // the customer branch has no shape in which the organisation could be
      // omitted; the anonymous branch has none to carry (FR-011).
      comparison = em.create(Comparison, {
        shareToken: this.tokens.generate(),
        ...ownerColumns(await this.#resolveOwner(owner)),
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
    /**
     * Feature 163, owner decision CMP-1 = A — whether the reader is the comparison's
     * owner. A column whose product is not available at the reader's (channel,
     * language) is the owner's own history: the owner keeps it with `available:
     * false`, any other reader gets the `(removed product)` column. Defaulted to
     * `'recipient'`, the answer that discloses nothing.
     */
    reader: ComparisonReader = 'recipient',
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
    const visibleToReader =
      viewer.kind === 'administrator'
        ? stored
        : stored.filter((product) => isProductVisibleTo(product, viewer.audience));
    const hiddenProductCount = stored.length - visibleToReader.length;
    const visibleProductIds = visibleToReader.map((p) => p.id);

    // Feature 163 — whether each column can still be acquired here, now, by
    // this reader, as `catalog` answers it; no status is tested in this module
    // (FR-002). An administrator reads it as the public would.
    const availableHere =
      visibleProductIds.length > 0
        ? await this.availability.filterAvailable(visibleProductIds, {
            channelId: viewerSalesChannelId,
            languageCode: comparisonScopeLanguage(
              viewerSalesChannelId,
              viewer.kind === 'buyer' ? viewer.languageTag : undefined,
            ),
            audience: viewer.kind === 'buyer' ? viewer.audience : ANONYMOUS_PRODUCT_AUDIENCE,
          })
        : new Set<string>();
    // Owner decision CMP-1 = A — for anybody but the owner, an unavailable column
    // is the `(removed product)` column below: nothing of it is read, priced or
    // projected, and `hiddenProductCount` does not count it, so a removed product
    // and an unavailable one read the same.
    //
    // Owner decision SEC-2 = A (2026-10-27) — the owner keeps the history column
    // only for a lifecycle reason (off at the scope, archived, outside the window,
    // not a member of the channel). A column the channel's effective audience
    // refuses the owner is one they may no longer see, so it collapses to the
    // `(removed product)` column for them too, and is counted nowhere. Asked of
    // `catalog` for the owner's unavailable columns only; a non-member is absent
    // from the answer and stays lifecycle. The operator's audit view
    // (`administrator`) is not a buyer and keeps every column.
    const refusedByAudience = new Set<string>();
    if (reader === 'owner' && viewer.kind === 'buyer') {
      const unavailable = visibleProductIds.filter((id) => !availableHere.has(id));
      if (unavailable.length > 0) {
        const described = await this.availability.describeChannelAvailability(unavailable, viewerSalesChannelId);
        for (const id of unavailable) {
          const inChannel = described.get(id);
          if (inChannel && !isProductVisibleTo(inChannel.audience, viewer.audience)) refusedByAudience.add(id);
        }
      }
    }
    const products =
      reader === 'owner'
        ? visibleToReader.filter((p) => !refusedByAudience.has(p.id))
        : visibleToReader.filter((p) => availableHere.has(p.id));
    const productById = new Map(products.map((p) => [p.id, p]));
    const shownProductIds = products.map((p) => p.id);

    const channel = await em.findOne(SalesChannel, { id: viewerSalesChannelId });
    const currency = channel?.defaultCurrency ?? 'PLN';

    const viewerOrganization =
      viewer.kind === 'buyer' ? await this.#viewerOrganization(viewer.audience) : null;

    // The pricing engine's answer per product (issue #132), resolved for the
    // viewer: a viewer whose display mode is `none` gets the withheld arm and
    // every column renders `null` (issues #491, #492).
    const resolvedPrices =
      products.length > 0
        ? await this.#requireListingPrices().resolveListingPrices({
            products,
            context: {
              salesChannel: { id: viewerSalesChannelId, defaultCurrency: currency },
              organization: viewerOrganization,
              // D-287 P0 — the customer's own group, as on the catalogue listing.
              ...(viewerOrganization && viewer.kind === 'buyer' && viewer.audience.customerAccountId
                ? { customerAccountId: viewer.audience.customerAccountId }
                : {}),
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
    const baseImageByProduct =
      shownProductIds.length > 0
        ? // Feature 163 (FR-076, owner decision MED-1 = A) — the base image as the
          // viewer's resolved channel shows it: an image hidden there is not served.
          await this.catalogGallery.baseImageUrls(shownProductIds, viewerSalesChannelId)
        : new Map<string, string | null>();

    // Comparable attribute definitions (catalog adapter port — Constitution I).
    // `listByFlag` orders by key ASC, matching the pre-061 entity query.
    const attributeDefs = this.catalogAttributes
      ? await this.catalogAttributes.listByFlag('isComparable')
      : [];

    // A row this reader may not see is dropped; a row whose product is *gone*
    // still renders as `(removed product)`, which is the owner's own history
    // and says nothing about anybody's entitlement.
    const readerMaySee = new Set(visibleProductIds);
    const withheldIds = new Set(
      stored.filter((p) => !readerMaySee.has(p.id)).map((p) => p.id),
    );
    const visibleRows = bridgeRows.filter((row) => !withheldIds.has(row.productId));
    // Feature 163 (FR-017 c) — names and compared values as the storefront
    // shows them at this reader's (channel, language): #384's walk over this
    // channel's override rows, from `catalog`'s read port.
    const scopeLanguage = comparisonScopeLanguage(
      viewerSalesChannelId,
      viewer.kind === 'buyer' ? viewer.languageTag : undefined,
    );
    const effective = await this.#effectiveValues(
      products,
      viewerSalesChannelId,
      scopeLanguage ?? channel?.defaultLanguage ?? null,
      channel?.defaultLanguage ?? undefined,
      attributeDefs,
    );
    // Feature 163 — each column's link and minimum in this channel: the effective
    // URL key at the reader's (channel, language) (T113a, R28) and the channel's
    // minimum (FR-100), one read each for the view.
    const keyLanguage = scopeLanguage ?? channel?.defaultLanguage ?? null;
    const [keysByProduct, rulesByProduct] =
      shownProductIds.length > 0
        ? await Promise.all([
            this.urlKeys
              ? this.urlKeys.effectiveKeys(shownProductIds, viewerSalesChannelId)
              : Promise.resolve(new Map<string, Map<string, string>>()),
            this.availability.effectiveOrderRules(shownProductIds, viewerSalesChannelId),
          ])
        : [new Map<string, Map<string, string>>(), new Map<string, { minOrderQuantity: number | null; returnable: boolean }>()];
    const productSummaries = visibleRows.map((row) => {
      const p = productById.get(row.productId);
      if (!p) {
        return {
          // Final security review S-L1a — a reader other than the owner learns
          // nothing from this column, its product's id included: an opaque key,
          // fresh per view. The owner keeps the id, which they added and remove
          // the column by (`DELETE /me/products/:productId`).
          id: reader === 'owner' ? row.productId : randomUUID(),
          sku: '',
          name: '(removed product)',
          slug: '',
          type: 'simple' as const,
          primaryAssetUrl: null,
          price: null,
          available: false,
          minOrderQuantity: null,
          addedAt: row.addedAt.toISOString(),
        };
      }
      const resolved = resolvedPrices.get(p.id);
      const price = resolved === undefined ? null : listingPriceMoney(resolved);
      return {
        id: p.id,
        sku: p.sku,
        name: effective.names.get(p.id) ?? p.name,
        slug: (keyLanguage !== null ? keysByProduct.get(p.id)?.get(keyLanguage) : undefined) ?? p.slug,
        type: p.type,
        primaryAssetUrl: baseImageByProduct.get(p.id) ?? null,
        price,
        available: availableHere.has(p.id),
        // Feature 155 (FR-014) — emitted for the types the minimum applies to only.
        // Feature 163 (FR-100) — the reader's channel's minimum.
        minOrderQuantity: isOrderMinimumEligibleType(p.type)
          ? rulesByProduct.has(p.id)
            ? (rulesByProduct.get(p.id)?.minOrderQuantity ?? null)
            : p.minOrderQuantity
          : null,
        addedAt: row.addedAt.toISOString(),
      };
    });

    const comparableAttributes = this.projection.projectRows(
      productSummaries.map((s) => {
        const p = productById.get(s.id);
        return { attributeValues: (p && effective.values.get(p.id)) ?? p?.attributeValues ?? {} };
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

/**
 * A {@link ComparisonOwner} with everything a row needs to be written from —
 * feature 087 Group B, D-187.
 *
 * The customer arm carries the organisation because
 * `comparisons_organization_attribution_chk` requires it, and it is a separate
 * type rather than a second field on {@link ComparisonOwner} because the
 * caller's identity genuinely does not include it: a route reads the account
 * off the session, and the organisation is a fact about that account which the
 * service resolves through `customer_accounts`' read port. Keeping the two
 * types apart is what makes "an owned comparison with no organisation" an
 * unrepresentable argument to {@link ownerColumns} rather than a line somebody
 * has to remember.
 */
type ResolvedComparisonOwner =
  | { kind: 'customer'; customerAccountId: string; organizationId: string }
  | { kind: 'anonymous'; anonymousToken: string };

function ownerWhere(owner: ComparisonOwner): Record<string, unknown> {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId }
    : { anonymousToken: owner.anonymousToken };
}

function ownerColumns(owner: ResolvedComparisonOwner): {
  customerAccountId: string | null;
  organizationId: string | null;
  anonymousToken: string | null;
} {
  return owner.kind === 'customer'
    ? {
        customerAccountId: owner.customerAccountId,
        organizationId: owner.organizationId,
        anonymousToken: null,
      }
    : {
        customerAccountId: null,
        // FR-011 — an anonymous comparison belongs to no organisation, and the
        // constraint says nothing about it. Who it *should* belong to is R-6's
        // open question and is not answered here.
        organizationId: null,
        anonymousToken: owner.anonymousToken,
      };
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


/**
 * Feature 163 — the scope language L of a comparison read: the request's tag
 * resolved against the request channel's own languages when the comparison is
 * read on that channel, else `null` (the channel's default language).
 */
function comparisonScopeLanguage(channelId: string, languageTag: string | undefined): string | null {
  const channel = currentSalesChannel();
  if (!channel || channel.id !== channelId) return null;
  return scopeLanguageOf(channel, languageTag);
}
