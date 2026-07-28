import { META_DISABLED_CONFIG, type MetaStorefrontConfig } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

/**
 * Per-sales-channel Meta Ads config for the active channel. Backs the Pixel
 * injection and the event dispatcher.
 *
 * Returns a disabled config rather than throwing when the backend is
 * unreachable or the module is off — ad tracking must never break the render.
 */
export async function getMetaAdsConfig(
  ctx: RequestContext = {},
): Promise<MetaStorefrontConfig> {
  try {
    const res = await apiGet<{ data: MetaStorefrontConfig }>(
      '/api/v1/storefront/meta-ads/config',
      ctx,
      { revalidate: 300, tags: ['meta:config'] },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError) return META_DISABLED_CONFIG;
    throw err;
  }
}
