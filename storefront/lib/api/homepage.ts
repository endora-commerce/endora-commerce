import type { HomepageConfig } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

/**
 * Resolved storefront home-page configuration for the active sales channel.
 * Returns `{ cmsPageSlug: null }` (built-in landing page) when the setting is
 * unconfigured or the backend is unreachable — the home page must always
 * render.
 */
export async function getHomepageConfig(
  ctx: RequestContext = {},
): Promise<HomepageConfig> {
  try {
    const res = await apiGet<{ data: HomepageConfig }>(
      '/api/v1/storefront/homepage',
      ctx,
      { revalidate: 300, tags: ['shop:homepage'] },
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError) return { cmsPageSlug: null };
    throw err;
  }
}
