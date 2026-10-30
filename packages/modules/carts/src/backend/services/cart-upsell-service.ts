import type { EntityManager } from '@mikro-orm/postgresql';
import {
  isProductVisibleTo,
  type CatalogProductAvailabilityPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type CatalogProductUrlKeyReadPort,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { CartItem } from '../entities/cart-item.entity.js';
import { effectiveKeysAt } from './cart-availability.js';

/**
 * Cart up-sell aggregator (feature 027 §R9 / FR-039).
 *
 * Walks `product_links` (kind = `up_sell`) for every product currently in
 * the cart, aggregates by target product, drops candidates that are
 * already in the cart, and ranks by match-count (most-linked-from first),
 * tie-breaking by older `created_at`.
 *
 * The catalog module's `ProductLink.kind = 'up_sell'` is the source the
 * spec calls "Up-sell" (the same relation surfaced on PDP). The strip's
 * placement is the cart UI; the relation type is the same.
 */

export interface CartUpsellCandidate {
  productId: string;
  productName: string;
  productSlug: string;
  productThumbnailUrl: string | null;
  matchCount: number;
}

export class CartUpsellService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * `catalog`'s product read model (feature 075, Phase C). Both reads this
     * replaced — the `up_sell` links and the target rows — were `em.find`
     * against `catalog`'s tables, so a switched-off `catalog` still filled the
     * cart's up-sell strip with products the platform had stopped serving.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    /**
     * Feature 163 — `catalog`'s availability answer for the strip's targets.
     * Optional only in the signature: a call that names a channel without it
     * fails loudly rather than showing the strip unfiltered.
     */
    private readonly availability?: Pick<CatalogProductAvailabilityPort, 'filterAvailable'>,
    /**
     * Feature 163 (T113a, R28) — with a scope, a target links to its effective
     * key at the basket's (channel, language); without one, its global key.
     */
    private readonly urlKeys?: Pick<CatalogProductUrlKeyReadPort, 'effectiveKeys'>,
  ) {}

  async forCart(
    cartId: string,
    limit: number,
    /**
     * Who is looking at the strip (issue #227). Required: this method returns
     * a product's name, slug and thumbnail for rows the buyer never asked for
     * by id, which makes it a listing rather than a lookup, and a listing that
     * defaulted its audience would silently show the wrong one.
     */
    audience: ProductAudience,
    /**
     * Feature 163 — the basket's channel and scope language. A target is shown
     * only where it is effectively available there to `audience`, now.
     */
    scope?: { channelId: string; languageCode: string | null },
  ): Promise<CartUpsellCandidate[]> {
    if (limit <= 0) return [];
    const em = this.emFactory();

    const items = await em.find(CartItem, { cartId });
    if (items.length === 0) return [];

    const sourceProductIds = Array.from(new Set(items.map((it) => it.productId)));

    // One query: every up_sell link emanating from any of the source
    // products. The target set is deduplicated in app code so we can
    // attach match-counts cheaply.
    const links = await this.catalogProducts.listLinksBySourceIds(sourceProductIds, 'up_sell');
    if (links.length === 0) return [];

    const matchCountByTarget = new Map<string, number>();
    for (const link of links) {
      // Exclude products already in the cart.
      if (sourceProductIds.includes(link.targetProductId)) continue;
      matchCountByTarget.set(
        link.targetProductId,
        (matchCountByTarget.get(link.targetProductId) ?? 0) + 1,
      );
    }
    if (matchCountByTarget.size === 0) return [];

    const targetIds = Array.from(matchCountByTarget.keys());
    // Issue #227 — an up-sell target is a product the buyer never named, so
    // the strip is a listing. A link from a product they may see to one they
    // may not does not make the second one theirs to see.
    // Feature 163 — with a scope, `catalog`'s availability answer holds the
    // channel-effective audience already, so it is the whole filter; without
    // one (outside a request) the global audience rule is, as before.
    let products = await this.catalogProducts.findByIds(targetIds);
    if (scope) {
      if (!this.availability) {
        throw new Error('[carts] CartUpsellService: the availability port is not wired.');
      }
      const available = await this.availability.filterAvailable(
        products.map((p) => p.id),
        { channelId: scope.channelId, languageCode: scope.languageCode, audience },
      );
      products = products.filter((p) => available.has(p.id));
    } else {
      products = products.filter((p) => isProductVisibleTo(p, audience));
    }
    const byId = new Map(products.map((p) => [p.id, p]));
    const keys =
      scope && this.urlKeys
        ? await effectiveKeysAt(this.urlKeys, products.map((p) => p.id), scope.channelId, scope.languageCode)
        : new Map<string, string>();

    const candidates: CartUpsellCandidate[] = targetIds
      .map((id) => byId.get(id))
      .filter((p): p is CatalogProductRecord => Boolean(p))
      .map((p) => ({
        productId: p.id,
        productName: this.localizedName(p),
        productSlug: keys.get(p.id) ?? p.slug,
        productThumbnailUrl: this.thumbnailFor(p),
        matchCount: matchCountByTarget.get(p.id) ?? 0,
      }));

    candidates.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      // Tie-break by older `created_at` (the existing product wins over
      // a newly-added one). Sorted post-mapping for clarity.
      const aProduct = byId.get(a.productId);
      const bProduct = byId.get(b.productId);
      const aTime = aProduct?.createdAt?.getTime() ?? 0;
      const bTime = bProduct?.createdAt?.getTime() ?? 0;
      return aTime - bTime;
    });

    return candidates.slice(0, limit);
  }

  private thumbnailFor(product: CatalogProductRecord): string | null {
    // The product record carries the `attributeValues` JSONB blob that
    // foundation code reads for `primaryAssetUrl`. We mirror that read
    // path; if missing, the caller's UI hides the thumbnail.
    const url = (product.attributeValues as Record<string, unknown> | null | undefined)?.[
      'primaryAssetUrl'
    ];
    return typeof url === 'string' && url.length > 0 ? url : null;
  }

  /**
   * Picks the most useful locale from the multilingual `name` JSONB. The
   * cart UI hands the buyer's session locale to the API; the resolver in
   * front of this service is expected to use that. For now we fall
   * through to the first available locale, matching the foundation's
   * "best-effort" rendering pattern.
   */
  private localizedName(product: CatalogProductRecord): string {
    // 168-shim: the Global name (`contracts/readers.md` §1).
    return product.name || product.id;
  }
}
