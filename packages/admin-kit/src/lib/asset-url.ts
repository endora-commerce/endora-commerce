import { apiBaseUrl } from './api-client.js';

/**
 * Resolve an asset URL returned by the backend into one the admin can load.
 *
 * The Assets Library backend serves files at `/assets/file/:assetId`. When the
 * `publicUrlBase` setting is left blank (the default, "use the request host"),
 * the resolved URL is host-relative (e.g. `/assets/file/<id>`). The admin SPA
 * runs on a different origin than the backend, so a host-relative URL resolves
 * against the admin origin and 404s. Prefix such URLs with the API base so the
 * browser fetches them from the backend.
 *
 * Absolute URLs (`http(s)://…`, `data:`, `blob:`) are returned unchanged.
 *
 * **Published by feature 091's P4c.** It lived in `assets_library`' admin
 * directory and was named by five other modules plus two `_shared` files, which
 * is seven reaches into module code for a two-branch string function whose only
 * input is the API origin the kit already publishes. Nothing about it is the
 * owner's: `admin-component-contribution.md` Z1.1.
 */
export function toAbsoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${apiBaseUrl.replace(/\/+$/, '')}${url}`;
  return url;
}
