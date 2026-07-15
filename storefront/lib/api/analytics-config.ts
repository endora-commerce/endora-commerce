import type { GaStorefrontConfig } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

const DISABLED_CONFIG: GaStorefrontConfig = {
  enabled: false,
  measurementId: null,
  enhancedEcommerce: false,
  serverSide: false,
  requireConsent: true,
  customEvents: [],
};

/**
 * Per-sales-channel Google Analytics config for the active channel. Backs the
 * storefront GA injection, page-view tracker, ecommerce hooks, and custom-event
 * collector.
 *
 * Returns a disabled config rather than throwing when the backend is
 * unreachable or the module is off — analytics must never break the render.
 */
export async function getGoogleAnalyticsConfig(
  ctx: RequestContext = {},
): Promise<GaStorefrontConfig> {
  try {
    const res = await apiGet<{ data: GaStorefrontConfig }>(
      '/api/v1/storefront/google-analytics/config',
      ctx,
      { revalidate: 300, tags: ['ga:config'] },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError) return DISABLED_CONFIG;
    throw err;
  }
}
