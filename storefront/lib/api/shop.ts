import type { ShopInfo } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

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
    if (err instanceof StorefrontApiError) return EMPTY_SHOP_INFO;
    throw err;
  }
}
