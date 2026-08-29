import type { InventoryDisplayMode, StorefrontProductStock } from '@endora-commerce/contracts';
import { apiGet, type RequestContext } from './client';
import { apiMutate } from './mutations';

/**
 * Storefront-public inventory bindings (feature 010 / US3+US5+US6).
 *
 * The display-mode endpoint feeds the StockBadge variant (exact /
 * band / available_or_not). The per-product stock endpoint sums
 * cumulative on-hand only over the warehouses bound to the caller's
 * resolved sales channel — so the storefront never leaks stock from
 * a B2B-only warehouse to a public channel.
 */

interface StockResponse {
  data: StorefrontProductStock;
}

interface DisplayModeResponse {
  data: { displayMode: InventoryDisplayMode };
}

export async function getStorefrontDisplayMode(
  ctx?: RequestContext,
): Promise<InventoryDisplayMode> {
  const res = await apiGet<DisplayModeResponse>(
    '/api/v1/storefront/inventory/display-mode',
    ctx,
    { revalidate: 60 },
  );
  return res.data.displayMode;
}

export async function getStorefrontProductStock(
  productId: string,
  ctx?: RequestContext,
): Promise<StorefrontProductStock | null> {
  try {
    const res = await apiGet<StockResponse>(
      `/api/v1/storefront/inventory/stock/${productId}`,
      ctx,
      { revalidate: 30 },
    );
    return res.data;
  } catch {
    // Stock endpoint failures are non-fatal — the PDP keeps rendering
    // with the foundation-era stockLevel/stockIndicator from the
    // catalog projection. Logged via the apiGet error handler.
    return null;
  }
}

export interface SubscribeNotifyResult {
  ok: true;
  subscriptionId: string;
}

export async function subscribeNotifyWhenAvailable(input: {
  productId: string;
  email: string;
  variantId?: string | null;
  sessionCookie?: string | null;
  ctx?: RequestContext;
}): Promise<SubscribeNotifyResult> {
  const res = await apiMutate<{
    subscriptionId?: string;
    requestedAt?: string;
  }>({
    method: 'POST',
    path: '/api/v1/storefront/inventory/notify-when-available',
    body: {
      productId: input.productId,
      email: input.email,
      ...(input.variantId ? { variantId: input.variantId } : {}),
    },
    ...(input.ctx ? { ctx: input.ctx } : {}),
    ...(input.sessionCookie ? { sessionCookie: input.sessionCookie } : {}),
  });
  return { ok: true, subscriptionId: res.data?.subscriptionId ?? '' };
}
