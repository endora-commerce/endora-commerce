import type { DisplayMode } from '@b2b/contracts';
import { apiGet, type RequestContext } from './client';

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
 * visits.
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
): Promise<ResolvedPrice | null> {
  const params = new URLSearchParams();
  params.set('quantity', String(query.quantity && query.quantity > 0 ? query.quantity : 1));
  if (query.currency) params.set('currency', query.currency.toUpperCase());
  if (query.variantId) params.set('variantId', query.variantId);
  try {
    const res = await apiGet<ResolvedPriceResponse>(
      `/api/v1/storefront/products/${encodeURIComponent(productId)}/resolved-price?${params.toString()}`,
      ctx,
      { revalidate: 60, tags: ['pricing:resolved', `pricing:product:${productId}`] },
    );
    return res.data.resolvedPrice;
  } catch {
    // Pricing failures are non-fatal at the rendering surface — the caller
    // falls back to the foundation-era ProductSummary.price projection.
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
      if (resolved) out.set(id, resolved);
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
): Promise<ProductDisplayMode | null> {
  try {
    const res = await apiGet<DisplayModeOnlyResponse>(
      `/api/v1/storefront/pricing/display-mode/${encodeURIComponent(productId)}`,
      ctx,
      { revalidate: 60, tags: ['pricing:display-mode', `pricing:product:${productId}`] },
    );
    return { displayMode: res.data.displayMode };
  } catch {
    return null;
  }
}
