/**
 * Make an asset / API path absolute for email clients (and other off-host consumers).
 * Relative `/assets/file/...` URLs only work in a browser on the API host.
 */
export function absolutizePublicUrl(
  url: string | null | undefined,
  publicBase = process.env['BACKEND_PUBLIC_URL'] ?? process.env['PUBLIC_API_BASE_URL'] ?? '',
): string {
  if (!url) return '';
  if (/^(https?:|data:|mailto:)/i.test(url)) return url;
  const base = publicBase.replace(/\/+$/, '');
  if (!base) return url;
  if (url.startsWith('/')) return `${base}${url}`;
  return `${base}/${url}`;
}
