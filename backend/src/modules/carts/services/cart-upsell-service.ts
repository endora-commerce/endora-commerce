import type { EntityManager } from '@mikro-orm/postgresql';
import { ProductLink } from '../../catalog/entities/product-link.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';

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
  constructor(private readonly emFactory: () => EntityManager) {}

  async forCart(cartId: string, limit: number): Promise<CartUpsellCandidate[]> {
    if (limit <= 0) return [];
    const em = this.emFactory();

    const items = await em.find(CartItem, { cartId });
    if (items.length === 0) return [];

    const sourceProductIds = Array.from(new Set(items.map((it) => it.productId)));

    // One query: every up_sell link emanating from any of the source
    // products. The target set is deduplicated in app code so we can
    // attach match-counts cheaply.
    const links = await em.find(ProductLink, {
      sourceProductId: { $in: sourceProductIds },
      kind: 'up_sell',
    });
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
    const products = await em.find(Product, { id: { $in: targetIds } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const candidates: CartUpsellCandidate[] = targetIds
      .map((id) => byId.get(id))
      .filter((p): p is Product => Boolean(p))
      .map((p) => ({
        productId: p.id,
        productName: this.localizedName(p),
        productSlug: p.slug,
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

  private thumbnailFor(product: Product): string | null {
    // The Product entity carries an `attributeValues` JSONB blob that
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
  private localizedName(product: Product): string {
    if (!product.name || typeof product.name !== 'object') return product.id;
    const en = product.name['en-US'] ?? product.name['en'];
    if (typeof en === 'string' && en.length > 0) return en;
    const first = Object.values(product.name).find((v) => typeof v === 'string' && v.length > 0);
    return (first as string) ?? product.id;
  }
}
