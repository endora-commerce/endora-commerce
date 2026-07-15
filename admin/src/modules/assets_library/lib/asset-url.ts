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
 */
const apiBaseUrl =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export function toAbsoluteAssetUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${apiBaseUrl.replace(/\/+$/, '')}${url}`;
  return url;
}
