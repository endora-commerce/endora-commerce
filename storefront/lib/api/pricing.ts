import type { DisplayMode } from '@endora-commerce/contracts';
import { apiGetForViewer, type RequestContext } from './client';
import { isModuleDisabled } from './module-absence';

/**
 * Storefront-public pricing bindings (feature 011 / US5+US6+US7).
 *
 * The resolved-price endpoint returns the per-customer Base + (optional) Sale
 * price for a single product, along with the resolved display mode and the
 * currently-applicable quantity bracket. A bulk variant is exposed as a
 * convenience wrapper that fans out to the singular endpoint in parallel —
 * the backend's batch route is documented in `pricing-resolution.contract.md`
 * but is not yet implemented; the wrapper keeps the call-sites stable.
 *
 * Backend caches the per-tuple result for 60 s; the singular endpoint also
 * uses Next's revalidate window so warm cache hits stay cheap on repeat
 * visits — for an anonymous visitor. A signed-in buyer's price is resolved for
 * their organisation and is never stored in a shared cache (issue #265), and
 * the same holds for the display mode beside it (issue #271).
 */

/**
 * Wire shape of a money value returned by the resolver. Backend serialises
 * the bracket amount as a decimal string (so 199.00 PLN stays 199.00 across
 * the wire), so we keep the field as a string and hand it to the formatters
 * verbatim.
 */
export interface PricingMoney {
  amount: string;
  currency: string;
}

export interface ResolvedPrice {
  baseListId: string;
  basePrice: PricingMoney | null;
  saleListId: string | null;
  salePrice: PricingMoney | null;
  displayMode: DisplayMode;
  currencyCode: string;
  quantityBracket: {
    minQuantity: number;
    maxQuantity: number | null;
  } | null;
}

/**
 * The pricing module is not present — issue #124.
 *
 * Distinct from `null`, which is the engine answering "no price list applies to
 * this product for this buyer". Callers must render an absence: no price, and no
 * action that would post a price back. Collapsing the two is how an absent
 * `price_lists` came to show the catalogue's legacy `defaultPrice` on a product
 * page whose Add-to-cart button could only ever return 503.
 */
export const PRICING_UNAVAILABLE = 'pricing-unavailable' as const;
export type PricingUnavailable = typeof PRICING_UNAVAILABLE;

interface ResolvedPriceResponse {
  data: { resolvedPrice: ResolvedPrice };
}

interface DisplayModeOnlyResponse {
  data: { displayMode: DisplayMode };
}

export interface ResolvePriceQuery {
  quantity?: number | undefined;
  currency?: string | undefined;
  variantId?: string | undefined;
}

export async function getResolvedPrice(
  productId: string,
  query: ResolvePriceQuery = {},
  ctx?: RequestContext,
): Promise<ResolvedPrice | PricingUnavailable | null> {
  const params = new URLSearchParams();
  params.set('quantity', String(query.quantity && query.quantity > 0 ? query.quantity : 1));
  // Fall back to the buyer's selected display currency (the `currency` cookie,
  // threaded through the request context) when the caller doesn't pass one, so
  // the header currency switcher reprices the resolved-price surfaces.
  const currency = query.currency ?? ctx?.currency;
  if (currency) params.set('currency', currency.toUpperCase());
  if (query.variantId) params.set('variantId', query.variantId);
  try {
    // Issue #265 — the endpoint's whole purpose is "what does THIS buyer pay",
    // and this call forwarded no credential and cached the answer for 60 s in a
    // cache shared by every visitor, so it could only ever ask the anonymous
    // question. `apiGetForViewer` keeps that request byte-identical for a
    // visitor with no session and sends the buyer's cookie, uncached, for one
    // with a session.
    const res = await apiGetForViewer<ResolvedPriceResponse>(
      `/api/v1/storefront/products/${encodeURIComponent(productId)}/resolved-price?${params.toString()}`,
      ctx,
      { revalidate: 60, tags: ['pricing:resolved', `pricing:product:${productId}`] },
    );
    return res.data.resolvedPrice;
  } catch (err) {
    // A switched-off `price_lists` is a decision the platform made, and it is
    // the one failure a rendering surface must not paper over (issue #124).
    if (isModuleDisabled(err)) return PRICING_UNAVAILABLE;
    // Everything else stays non-fatal here: a transient pricing failure should
    // not take a product page down, and the caller falls back to the
    // foundation-era ProductSummary.price projection. Narrowing that tolerance
    // further is a separate question from module presence.
    return null;
  }
}

/**
 * Bulk fetch — keeps the call-site shape the contract describes even though
 * the backend batch endpoint isn't implemented yet. Resolves to a Map keyed
 * by productId; missing entries are absent from the Map. Fans out at most
 * `concurrency` calls in flight at once to avoid overrunning the backend.
 */
export async function getResolvedPricesBulk(
  productIds: readonly string[],
  query: ResolvePriceQuery = {},
  ctx?: RequestContext,
  concurrency = 8,
): Promise<Map<string, ResolvedPrice>> {
  const out = new Map<string, ResolvedPrice>();
  const queue = [...productIds];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) return;
      const resolved = await getResolvedPrice(id, query, ctx);
      // An absence contributes no entry, exactly as "no price" does: the bulk
      // map is a lookup of prices that exist, and the caller's own absence
      // handling belongs on the surface, not in a Map miss.
      if (resolved && resolved !== PRICING_UNAVAILABLE) out.set(id, resolved);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, productIds.length) }, worker));
  return out;
}

export interface ProductDisplayMode {
  displayMode: DisplayMode;
  resolvedFrom?: 'product' | 'category' | 'organization' | 'settings.default' | 'settings.unauthenticated';
}

export async function getProductDisplayMode(
  productId: string,
  ctx?: RequestContext,
): Promise<ProductDisplayMode | PricingUnavailable | null> {
  try {
    // Issue #271 — "net or gross?" is the same per-viewer question the price
    // is, and the cart is the surface that asks it. This call went through
    // `apiGet`, which forwards no credential, with a 60 s window in a cache
    // every visitor reads: the backend could not tell who was asking, and the
    // answer would have stayed shared even after it learned to. Both halves are
    // closed by `apiGetForViewer`, which keeps the anonymous request
    // byte-identical and sends the buyer's cookie uncached for a signed-in one.
    const res = await apiGetForViewer<DisplayModeOnlyResponse>(
      `/api/v1/storefront/pricing/display-mode/${encodeURIComponent(productId)}`,
      ctx,
      { revalidate: 60, tags: ['pricing:display-mode', `pricing:product:${productId}`] },
    );
    return { displayMode: res.data.displayMode };
  } catch (err) {
    if (isModuleDisabled(err)) return PRICING_UNAVAILABLE;
    return null;
  }
}
