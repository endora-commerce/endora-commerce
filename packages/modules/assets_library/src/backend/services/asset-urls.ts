// The URL forms and dispositions the library hands out —
// specs/156-asset-stable-url/contracts/file-serving.md §3–§4, research R-8 and R-12a.

import { isSvg, servingPolicyFor } from './content-policy.js';

export type AssetStorageBackend = 'local' | 's3' | 'gcs' | 'legacy';

/**
 * The embed form of a URL: `url?v=<contentVersion>`. Unchanged for a legacy
 * row (its stored URL is not ours to rewrite), a `data:` URL, and a URL that
 * already carries a query — a signed URL, whose signature covers its query.
 */
export function versionedAssetUrl(
  url: string,
  contentVersion: string,
  backend: AssetStorageBackend,
): string {
  if (backend === 'legacy') return url;
  if (url.startsWith('data:')) return url;
  if (url.includes('?')) return url;
  return `${url}?v=${contentVersion}`;
}

/**
 * The absolute permalink URL on the local public base. A permalink holds only
 * `[A-Za-z0-9._/-]` (`validateAssetPermalink`), so it needs no encoding.
 */
export function permalinkUrl(base: string, permalink: string): string {
  return `${base.replace(/\/+$/, '')}/assets/file/${permalink}`;
}

export type ContentDispositionMode = 'inline' | 'attachment';

/** Everything outside printable ASCII, plus the characters that would break the quoted value. */
const UNSAFE_FALLBACK = /[^\x20-\x7e]|["%;\\]/gu;

/** RFC 5987 `attr-char` encoding: `encodeURIComponent` plus the characters it leaves alone. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * The one builder of every `Content-Disposition` value the module writes — the
 * route's response header and the cloud object metadata:
 * `<mode>; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded>`.
 * The fallback replaces `"`, `;`, `\`, `%`, every control character and every
 * non-ASCII character with `_`, so the value never carries CR or LF.
 */
export function contentDispositionHeader(mode: ContentDispositionMode, filename: string): string {
  const fallback = filename.replace(UNSAFE_FALLBACK, '_');
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

/**
 * The disposition stored on a cloud object (owner ruling P4): `inline` only
 * for a type the serving policy shows in the browser and never for an SVG,
 * because a bucket response carries no policy header of ours.
 */
export function cloudContentDisposition(mimeType: string, filename: string): string {
  const inline = servingPolicyFor(mimeType).inline && !isSvg({ filename, mimeType });
  return contentDispositionHeader(inline ? 'inline' : 'attachment', filename);
}

/**
 * The headers a cloud signed URL makes the bucket answer with (issue #815): the
 * stored type and the disposition {@link cloudContentDisposition} chooses, or an
 * attachment when the caller asked for a download. A bucket response cannot
 * carry `X-Content-Type-Options`, so pinning these two is what the URL can do.
 */
export function signedResponseHeaders(
  asset: { mimeType: string; filename: string },
  download = false,
): { contentType: string; contentDisposition: string } {
  return {
    contentType: asset.mimeType,
    contentDisposition: download
      ? contentDispositionHeader('attachment', asset.filename)
      : cloudContentDisposition(asset.mimeType, asset.filename),
  };
}
