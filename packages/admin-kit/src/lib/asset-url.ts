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
 * Absolute URLs (`http(s)://…`, `data:`, `blob:`) and **protocol-relative**
 * ones (`//cdn.example.com/x.png`) are returned unchanged.
 *
 * **Published by feature 091's P4c.** It lived in `assets_library`' admin
 * directory and was named by five other modules plus two `_shared` files, which
 * is seven reaches into module code for a two-branch string function whose only
 * input is the API origin the kit already publishes. Nothing about it is the
 * owner's: `admin-component-contribution.md` Z1.1.
 *
 * **Two behaviours came from the ninth private copy, batch 10's** (feature 091).
 * `settings`' `ImageSettingInput` carried its own implementation of this
 * function — invisible to P4c, because a copy that no module reaches is not a
 * cross-module reach — and it handled two cases this one did not: it trimmed,
 * and it treated a protocol-relative URL as already absolute. The second is a
 * defect rather than a preference: `//cdn.example.com/x.png` starts with `/`,
 * so prefixing it produced `https://api.example.com//cdn.example.com/x.png`,
 * which loads nothing. Both are folded in here rather than kept in a tenth
 * copy, and neither can break a caller — a trailing space and a broken origin
 * are not results anybody relies on.
 */
export function toAbsoluteAssetUrl(url: string | null | undefined): string {
  const trimmed = url?.trim() ?? '';
  if (trimmed === '') return '';
  if (/^(https?:|data:|blob:)/i.test(trimmed) || trimmed.startsWith('//')) return trimmed;
  if (trimmed.startsWith('/')) return `${apiBaseUrl.replace(/\/+$/, '')}${trimmed}`;
  return trimmed;
}
