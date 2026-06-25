/**
 * Same-origin PWA config endpoint (feature 046).
 *
 * The service worker and client components run on the storefront origin and
 * cannot reach the backend directly. This Next Route Handler proxies the
 * backend's public config (resolving the request's sales channel from the
 * `x-sales-channel` header) so the SW caching gate and the push opt-in have a
 * same-origin source. Falls back to sensible defaults if the backend is
 * unreachable, so the storefront degrades gracefully (no broken PWA UI).
 */

import { fetchPwaConfig } from '../../../lib/api/pwa-server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const channelCode = request.headers.get('x-sales-channel') ?? undefined;
  const config = await fetchPwaConfig(channelCode);
  return new Response(JSON.stringify(config), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
