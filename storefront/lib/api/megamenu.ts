import type { ResolvedMegamenu } from '@endora-commerce/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';

/**
 * Storefront client for the megamenu module — feature 015. Resolves the
 * active megamenu for the current `(channel, language)` scope. Returns
 * `null` when no megamenu is active so the layout can render a no-menu
 * fallback (a stripped-down `<header>` with no navigation panel).
 */
export async function getActiveMegamenu(ctx: RequestContext): Promise<ResolvedMegamenu | null> {
  const params = new URLSearchParams();
  if (ctx.locale) params.set('language', ctx.locale);
  const qs = params.toString();
  try {
    const out = await apiGet<{ data: ResolvedMegamenu }>(
      `/api/v1/megamenu/by-channel${qs ? `?${qs}` : ''}`,
      ctx,
      { revalidate: 60, tags: ['megamenu'] },
    );
    return out.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    // Megamenu must not break a page render. Log and fall back to no-menu.
    console.warn('[storefront] megamenu fetch failed', err);
    return null;
  }
}
