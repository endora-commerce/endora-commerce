import { LINKEDIN_DISABLED_CONFIG, type LinkedInStorefrontConfig } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

/**
 * Per-sales-channel LinkedIn Ads config for the active channel. Backs the
 * Insight Tag injection and the conversion dispatcher.
 *
 * Returns a disabled config rather than throwing when the backend is
 * unreachable or the module is off — ad tracking must never break the render.
 */
export async function getLinkedInAdsConfig(
  ctx: RequestContext = {},
): Promise<LinkedInStorefrontConfig> {
  try {
    const res = await apiGet<{ data: LinkedInStorefrontConfig }>(
      '/api/v1/storefront/linkedin-ads/config',
      ctx,
      { revalidate: 300, tags: ['linkedin:config'] },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError) return LINKEDIN_DISABLED_CONFIG;
    throw err;
  }
}
