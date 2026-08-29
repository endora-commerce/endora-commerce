import { GTM_DISABLED_CONFIG, type GtmStorefrontConfig } from '@endora-commerce/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

/**
 * Per-sales-channel Google Tag Manager config for the active channel. Backs the
 * container injection and the storefront's `dataLayer` emitter.
 *
 * Returns a disabled config rather than throwing when the backend is
 * unreachable or the module is off — tag management must never break the
 * render.
 */
export async function getGoogleTagManagerConfig(
  ctx: RequestContext = {},
): Promise<GtmStorefrontConfig> {
  try {
    const res = await apiGet<{ data: GtmStorefrontConfig }>(
      '/api/v1/storefront/google-tag-manager/config',
      ctx,
      { revalidate: 300, tags: ['gtm:config'] },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError) return GTM_DISABLED_CONFIG;
    throw err;
  }
}
