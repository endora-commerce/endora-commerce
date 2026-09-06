import { publicApiBaseUrl } from './env.mjs';

/**
 * Rebase host-relative asset URLs (e.g. `/assets/file/<assetId>`) onto the
 * public API origin so gallery/thumbnail images resolve against the backend
 * rather than the storefront origin.
 *
 * The Assets Library `publicUrlBase` setting defaults to blank ("use the
 * request host"), so the backend stores and returns host-relative URLs. In the
 * browser those would otherwise resolve against the Next.js storefront origin,
 * which has no `/assets/file/...` route — the image 404s and nothing renders.
 *
 * This is the storefront counterpart to the admin SPA's `toAbsoluteAssetUrl`
 * helper. It runs during SSR as well as on the client, so it MUST use the
 * public, build-time-baked `NEXT_PUBLIC_API_BASE_URL` — never the server-only
 * internal `BACKEND_BASE_URL` (`http://backend:3001`), which would break in the
 * browser (Mixed Content / unresolvable host).
 */
const apiBaseUrl = publicApiBaseUrl();

export function toAbsoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  // Absolute, data, and blob URLs pass through untouched.
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  // Host-relative URLs get rebased onto the public API origin.
  if (url.startsWith('/')) return `${apiBaseUrl.replace(/\/+$/, '')}${url}`;
  return url;
}
