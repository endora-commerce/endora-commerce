// What the public file route answers — specs/156-asset-stable-url/
// contracts/file-serving.md §2, research R-9 – R-12a, owner ruling P2.
//
// One pure function decides status, headers and body for a resolved request;
// the route only resolves the identifier, verifies the signature, resolves a
// storage URL when the decision asks for one, and applies the decision. Kept
// pure so every row of the decision table is tested without HTTP.

import { ERROR_CODES, type ErrorCode } from '@endora-commerce/contracts';

import { SANDBOX_CSP, servingPolicyFor } from './content-policy.js';
import { contentDispositionHeader } from './asset-urls.js';

export type IdentifierForm = 'id' | 'permalink';

export interface FileRow {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  visibility: 'public' | 'private';
  storageBackend: 'local' | 's3' | 'gcs' | 'legacy';
  storageLocator: string;
  storageUrl: string;
  contentVersion: string;
  permalink?: string | null;
  deletedAt?: Date | null;
}

export interface FileRequest {
  row: FileRow | null;
  form: IdentifierForm;
  query: { token?: string; exp?: string; download?: string; v?: string };
  ifNoneMatch?: string;
  /** Whether `token`/`exp` verify for `row.id`; only consulted for a private row. */
  signatureValid: boolean;
}

/** Where a redirect points; the route resolves the first two through the asset's adapter. */
export type FileLocation =
  | { kind: 'private-signed' }
  | { kind: 'stable'; version?: string }
  | { kind: 'url'; url: string };

export type FileDecision =
  | { status: 200; headers: Record<string, string>; body: 'stream' }
  | { status: 304; headers: Record<string, string>; body: 'none' }
  | { status: 302; headers: Record<string, string>; body: 'none'; location: FileLocation }
  | {
      status: 403 | 404 | 410;
      headers: Record<string, string>;
      body: { code: ErrorCode; message: string };
    };

/** Every answer that is not the file: no policy of the stored type, never cached. */
const REFUSAL_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': SANDBOX_CSP,
  'Cache-Control': 'no-store',
};

function refusal(status: 403 | 404 | 410, code: ErrorCode, message: string): FileDecision {
  return { status, headers: { ...REFUSAL_HEADERS }, body: { code, message } };
}

function redirect(location: FileLocation): FileDecision {
  return { status: 302, headers: { ...REFUSAL_HEADERS }, body: 'none', location };
}

const NOT_FOUND = (): FileDecision => refusal(404, ERROR_CODES.ASSET_NOT_FOUND, 'Asset not found.');

export function fileEtag(row: Pick<FileRow, 'id' | 'contentVersion'>): string {
  return `"${row.id}-${row.contentVersion}"`;
}

/** `/assets/file/<id>` or `/assets/file/<stored permalink, each segment encoded>`, then `?v=<current>`. */
export function canonicalLocation(row: FileRow, form: IdentifierForm, download: boolean): string {
  const path =
    form === 'permalink' && row.permalink
      ? row.permalink.split('/').map(encodeURIComponent).join('/')
      : row.id;
  return `/assets/file/${path}?v=${encodeURIComponent(row.contentVersion)}${download ? '&download=1' : ''}`;
}

/** The opaque part of an entity tag, its weak prefix dropped. */
function opaqueTag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

/**
 * `If-None-Match` against our tag, with the weak comparison RFC 9110 §13.1.2
 * prescribes for GET: `*`, a list, and a `W/` tag — a compressing proxy weakens
 * the tag it passes on — all match.
 */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === '*') return true;
  const wanted = opaqueTag(etag);
  return header.split(',').some((candidate) => opaqueTag(candidate) === wanted);
}

function serve(row: FileRow, request: FileRequest, cacheControl: string): FileDecision {
  const policy = servingPolicyFor(row.mimeType);
  const etag = fileEtag(row);
  const shared: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': policy.contentSecurityPolicy,
    'Cache-Control': cacheControl,
    ETag: etag,
  };
  // Public files are embedded cross-origin by the storefront and the admin. On
  // the 304 too: the browser merges its headers into the cached response, and
  // the host's default `same-origin` would replace the 200's and block the embed.
  if (row.visibility === 'public') shared['Cross-Origin-Resource-Policy'] = 'cross-origin';
  if (ifNoneMatchHits(request.ifNoneMatch, etag)) {
    return { status: 304, headers: shared, body: 'none' };
  }
  const download = request.query.download === '1' || !policy.inline;
  const headers: Record<string, string> = {
    ...shared,
    'Content-Type': row.mimeType,
    'Content-Disposition': contentDispositionHeader(download ? 'attachment' : 'inline', row.filename),
  };
  // A stale or legacy `0` would tell the browser the body is empty.
  if (Number(row.sizeBytes) > 0) headers['Content-Length'] = String(row.sizeBytes);
  return { status: 200, headers, body: 'stream' };
}

export function decideFileResponse(request: FileRequest): FileDecision {
  const { row, form, query } = request;

  // 1. Nothing by that identifier.
  if (!row) return NOT_FOUND();

  // 2. The signature comes first, before anything that depends on the row's
  //    state — so a private asset's deleted state, its ETag and its storage
  //    location are visible only to a valid signature. By permalink the answer
  //    is that of a name that resolves to nothing (owner ruling P2).
  if (row.visibility === 'private' && !request.signatureValid) {
    return form === 'id'
      ? refusal(403, ERROR_CODES.ASSET_ACCESS_DENIED, 'Access denied.')
      : NOT_FOUND();
  }

  // 3. Soft-deleted, whatever the form and the marker.
  if (row.deletedAt) return refusal(410, ERROR_CODES.ASSET_GONE, 'Asset has been deleted.');

  // 4. Private, signature valid.
  if (row.visibility === 'private') {
    if (row.storageBackend === 's3' || row.storageBackend === 'gcs') {
      return redirect({ kind: 'private-signed' });
    }
    if (row.storageBackend === 'legacy') {
      return refusal(404, ERROR_CODES.ASSET_FILE_MISSING, 'Underlying file is missing.');
    }
    return serve(row, request, 'private, no-store, max-age=0');
  }

  // 5. Public, not stored here.
  if (row.storageBackend === 's3' || row.storageBackend === 'gcs') {
    return redirect({
      kind: 'stable',
      ...(query.v !== undefined ? { version: row.contentVersion } : {}),
    });
  }
  if (row.storageBackend === 'legacy') {
    const stored = row.storageLocator || row.storageUrl;
    return /^https?:\/\//i.test(stored)
      ? redirect({ kind: 'url', url: stored })
      : refusal(404, ERROR_CODES.ASSET_FILE_MISSING, 'Underlying file is missing.');
  }

  // 6. Public, local.
  if (query.v === undefined) return serve(row, request, 'public, no-cache');
  if (query.v === row.contentVersion) {
    return serve(row, request, 'public, max-age=31536000, immutable');
  }
  return redirect({ kind: 'url', url: canonicalLocation(row, form, query.download === '1') });
}
