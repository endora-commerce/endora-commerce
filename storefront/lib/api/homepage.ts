import type { HomepageConfig } from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';
import { isModuleDisabled } from './module-absence';

/**
 * Resolved storefront home-page configuration for the active sales channel.
 * Returns `{ cmsPageSlug: null }` (built-in landing page) when the setting is
 * unconfigured or the backend is unreachable — the home page must always
 * render.
 *
 * Feature 073: a switched-off module resolves to the same built-in landing
 * page, and it resolves there because the projection said so, not because a
 * 503 was swallowed. The branch is spelled out so the two reasons stay
 * distinguishable in the code.
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
    if (isModuleDisabled(err)) return { cmsPageSlug: null };
    if (err instanceof StorefrontApiError) return { cmsPageSlug: null };
    throw err;
  }
}
