import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type {
  ComparisonOwnerView,
  ComparisonDisplayMode,
} from '@b2b/contracts';
import { Product } from '../../catalog/entities/product.entity.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { CatalogQueryService } from '../../catalog/services/catalog-query.service.js';
import type { CatalogAttributeReadService } from '../../catalog/services/catalog-attribute-read.service.js';
import type { SettingsService } from '../../settings/services/settings.service.js';
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
 * Stateful service owning the Comparison resource. Cross-module reads go
 * through the documented service ports {@link CatalogQueryService} and
 * {@link SettingsService}; no entity imports from another module's
 * internals (Constitution I).
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
export class ComparisonService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Catalog read port (constructor contract kept; attribute reads moved to `catalogAttributes`). */
    _catalogQuery: CatalogQueryService,
    private readonly projection: ComparableAttributeProjection,
    private readonly tokens: ShareTokenGenerator,
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
    private readonly catalogAttributes?: CatalogAttributeReadService,
  ) {}

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async getForOwner(owner: ComparisonOwner): Promise<Comparison | null> {
    const em = this.emFactory();
    return em.findOne(Comparison, ownerWhere(owner));
  }

  async findByShareToken(token: string): Promise<Comparison | null> {
    const em = this.emFactory();
    return em.findOne(Comparison, { shareToken: token });
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
  ): Promise<Comparison> {
    // command-coverage-ignore: transient customer working state (like carts) —
    // self-service convenience data, not an audited domain-state mutation.
    const em = this.emFactory();

    const product = await em.findOne(Product, { id: productId });
    if (!product) throw new ProductNotFoundError(productId);

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
   */
  async buildOwnerView(
    comparison: Comparison,
    viewerSalesChannelId: string,
  ): Promise<ComparisonOwnerView> {
    const em = this.emFactory();

    const bridgeRows = await em.find(
      ComparisonProduct,
      { comparisonId: comparison.id },
      { orderBy: { position: 'asc', addedAt: 'asc' } },
    );

    const productIds = bridgeRows.map((r) => r.productId);
    const products =
      productIds.length > 0
        ? await em.find(Product, { id: { $in: productIds } })
        : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const channel = await em.findOne(SalesChannel, { id: viewerSalesChannelId });
    const currency = channel?.defaultCurrency ?? 'PLN';
    const isPublic = channel?.isPublic ?? true;

    // Base-image lookup per product (label='base_image' only — spec
    // FR-006 names *base image* explicitly; no fallback to other labels).
    const baseImageByProduct =
      productIds.length > 0
        ? await this.loadBaseImageUrls(em, productIds)
        : new Map<string, string | null>();

    // Comparable attribute definitions (catalog adapter port — Constitution I).
    // `listByFlag` orders by key ASC, matching the pre-061 entity query.
    const attributeDefs = this.catalogAttributes
      ? await this.catalogAttributes.listByFlag('isComparable')
      : [];

    const productSummaries = bridgeRows.map((row) => {
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
      const rawPrice = Number(
        p.attributeValues['defaultPrice'] ?? p.attributeValues['price'] ?? Number.NaN,
      );
      const price =
        isPublic && Number.isFinite(rawPrice)
          ? { amount: rawPrice, currency }
          : null;
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

  /**
   * One product → one base-image URL, via `gallery_item_labels` with
   * `label='base_image'`. Returns `null` for products without one.
   */
  private async loadBaseImageUrls(
    em: EntityManager,
    productIds: string[],
  ): Promise<Map<string, string | null>> {
    const rows = await em.getConnection().execute<{
      product_id: string;
      storage_url: string;
    }[]>(
      `select gil.product_id, a.storage_url
         from gallery_item_labels gil
         join gallery_items gi on gi.id = gil.gallery_item_id
         join assets a on a.id = gi.asset_id
         where gil.label = 'base_image'
           and gil.product_id in (${productIds.map(() => '?').join(',')})`,
      productIds,
    );
    const out = new Map<string, string | null>();
    for (const id of productIds) out.set(id, null);
    for (const r of rows) out.set(r.product_id, r.storage_url);
    return out;
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
