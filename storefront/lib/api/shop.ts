import type { ShopInfo } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';
import { isModuleDisabled } from './module-absence';

const EMPTY_SHOP_INFO: ShopInfo = {
  name: '',
  address: '',
  contactEmail: '',
  supportEmail: '',
  phone: '',
};

/**
 * Public shop / company contact information for the active sales channel
 * (name, address, contact + support email, phone). Backs the storefront
 * footer, the 404 "need help?" block and the contact form.
 *
 * Returns empty strings rather than throwing when the backend is unreachable
 * or the settings are unconfigured — contact info is decorative on most pages
 * and must never break the render.
 *
 * Feature 073: that blanket swallow is exactly why storefront absence is
 * decided from the presence projection and not from a 503 — a switched-off
 * module would otherwise be indistinguishable from a network blip, and the
 * footer would keep rendering an empty block. The `MODULE_DISABLED` branch is
 * spelled out so the two cases are visible in the code rather than merged by
 * accident.
 */
export async function getShopInfo(ctx: RequestContext = {}): Promise<ShopInfo> {
  try {
    const res = await apiGet<{ data: ShopInfo }>(
      '/api/v1/storefront/shop-info',
      ctx,
      { revalidate: 300, tags: ['shop:info'] },
    );
    return res.data;
  } catch (err) {
    if (isModuleDisabled(err)) return EMPTY_SHOP_INFO;
    if (err instanceof StorefrontApiError) return EMPTY_SHOP_INFO;
    throw err;
  }
}
