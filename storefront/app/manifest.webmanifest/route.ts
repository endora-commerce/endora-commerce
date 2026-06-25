/**
 * Web app manifest (feature 046 / FR-001..FR-003, FR-011).
 *
 * Served as a Next.js Route Handler so the manifest reflects the admin-configured,
 * per-Sales-Channel PWA identity (name, short name, theme/background color, icons,
 * display mode) resolved from the backend at request time. Falls back to platform
 * defaults when the backend is unreachable so the manifest is always valid
 * (graceful degradation — US1 scenario 3).
 */

import { fetchPwaConfig } from '../../lib/api/pwa-server';

export const dynamic = 'force-dynamic';

export async function GET(request?: Request): Promise<Response> {
  const channelCode = request?.headers.get('x-sales-channel') ?? undefined;
  const config = await fetchPwaConfig(channelCode);

  const manifest = {
    name: config.appName,
    short_name: config.shortName,
    description: 'B2B commerce storefront',
    start_url: '/',
    scope: '/',
    display: config.displayMode,
    background_color: config.backgroundColor,
    theme_color: config.themeColor,
    icons: config.icons.map((icon) => ({
      src: icon.src,
      sizes: icon.sizes,
      type: icon.type,
      ...(icon.purpose ? { purpose: icon.purpose } : {}),
    })),
  };

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
