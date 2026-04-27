/**
 * Web app manifest (T236 / FR-104). Served as a Next.js Route Handler so
 * the manifest can pick up dynamic values from environment variables
 * without a build-time inline.
 *
 * Themes typically replace this file with a static manifest in their own
 * brand colours; the route handler is offered as a starting point.
 */

export const dynamic = 'force-static';

const NAME = process.env['NEXT_PUBLIC_APP_NAME'] ?? 'B2B Platform';
const SHORT_NAME = process.env['NEXT_PUBLIC_APP_SHORT_NAME'] ?? 'B2B';

export function GET(): Response {
  const manifest = {
    name: NAME,
    short_name: SHORT_NAME,
    description: 'B2B commerce storefront',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#1d4ed8',
    icons: [
      // Themes ship their own icons; the reference theme keeps placeholders
      // so Lighthouse's manifest audit has the keys present.
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
