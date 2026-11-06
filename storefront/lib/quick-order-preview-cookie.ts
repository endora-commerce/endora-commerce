import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { cookies } from 'next/headers';
import type { RejectedQuickOrderItem } from './api/quick-order';

/**
 * Issue #790 — where the quick-order preview lives between the import and the build.
 *
 * It used to travel in the URL (`?preview=<base64 JSON>`), so a crafted link could put any
 * preview, with any "raw" CSV text in its rejected rows, on a buyer's page — and the buyer's
 * own CSV sat in their history, in access logs and in the `Referer`. It lives in an httpOnly
 * cookie the storefront writes itself instead: a cross-site link cannot set it, the page stays
 * server-rendered, and nothing new is stored anywhere — the cookie is the same value the URL
 * carried, deflated, bound to the session that wrote it and dropped once the build succeeds.
 *
 * A cookie holds about 4 KB, so the value is split over at most `QUICK_ORDER_PREVIEW_MAX_CHUNKS`
 * cookies; a preview that does not fit is refused (`packQuickOrderPreview` returns `null`) and
 * the page asks for a shorter list, rather than showing a preview cut short. Kept well under
 * Node's 16 KB request-header limit, which the URL counted against too.
 */

export interface QuickOrderPreview {
  recognized: Array<{
    line: number;
    sku: string;
    productId: string;
    variantId: string | null;
    resolvedVariantSku?: string | null;
    quantity: number;
    mergedFromLines?: number[];
  }>;
  rejected: RejectedQuickOrderItem[];
  summary: { recognizedCount: number; rejectedCount: number; mergedCount: number; truncated: boolean };
}

export const QUICK_ORDER_PREVIEW_COOKIE = 'b2b_quick_order_preview';
/** The characters one cookie value may hold, leaving room for its name and attributes. */
export const QUICK_ORDER_PREVIEW_CHUNK_LIMIT = 3800;
export const QUICK_ORDER_PREVIEW_MAX_CHUNKS = 3;
/** Long enough to review a pasted list; the preview is a step, not a draft. */
const MAX_AGE_SECONDS = 60 * 60;

function chunkName(index: number): string {
  return index === 0 ? QUICK_ORDER_PREVIEW_COOKIE : `${QUICK_ORDER_PREVIEW_COOKIE}.${index}`;
}

/** Which session wrote the value — a digest, so the cookie never repeats the session id. */
function sessionTag(sessionCookie: string): string {
  return createHash('sha256').update(sessionCookie).digest('base64url').slice(0, 22);
}

/** The cookie values for `preview`, or `null` when it is too long to carry. */
export function packQuickOrderPreview(sessionCookie: string, preview: QuickOrderPreview): string[] | null {
  const json = JSON.stringify({ s: sessionTag(sessionCookie), p: preview });
  const value = deflateRawSync(Buffer.from(json, 'utf8')).toString('base64url');
  const chunks: string[] = [];
  for (let at = 0; at < value.length; at += QUICK_ORDER_PREVIEW_CHUNK_LIMIT) {
    chunks.push(value.slice(at, at + QUICK_ORDER_PREVIEW_CHUNK_LIMIT));
  }
  return chunks.length <= QUICK_ORDER_PREVIEW_MAX_CHUNKS ? chunks : null;
}

/** The preview `chunks` hold for this session, or `null` for anything else. */
export function unpackQuickOrderPreview(sessionCookie: string, chunks: readonly string[]): QuickOrderPreview | null {
  if (chunks.length === 0) return null;
  try {
    const json = inflateRawSync(Buffer.from(chunks.join(''), 'base64url')).toString('utf8');
    const value = JSON.parse(json) as { s?: unknown; p?: Partial<QuickOrderPreview> };
    if (value.s !== sessionTag(sessionCookie)) return null;
    const preview = value.p;
    if (!preview || !Array.isArray(preview.recognized) || !Array.isArray(preview.rejected)) return null;
    if (typeof preview.summary !== 'object' || preview.summary === null) return null;
    return preview as QuickOrderPreview;
  } catch {
    return null;
  }
}

export async function readQuickOrderPreview(sessionCookie: string): Promise<QuickOrderPreview | null> {
  const jar = await cookies();
  const chunks: string[] = [];
  for (let index = 0; index < QUICK_ORDER_PREVIEW_MAX_CHUNKS; index += 1) {
    const value = jar.get(chunkName(index))?.value;
    if (!value) break;
    chunks.push(value);
  }
  return unpackQuickOrderPreview(sessionCookie, chunks);
}

/** Writes the preview; `false` when it is too long to carry (and nothing is written). */
export async function writeQuickOrderPreview(sessionCookie: string, preview: QuickOrderPreview): Promise<boolean> {
  const chunks = packQuickOrderPreview(sessionCookie, preview);
  if (!chunks) return false;
  const jar = await cookies();
  for (let index = 0; index < QUICK_ORDER_PREVIEW_MAX_CHUNKS; index += 1) {
    const chunk = chunks[index];
    if (chunk === undefined) {
      jar.delete(chunkName(index));
      continue;
    }
    jar.set(chunkName(index), chunk, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production',
      maxAge: MAX_AGE_SECONDS,
    });
  }
  return true;
}

export async function clearQuickOrderPreview(): Promise<void> {
  const jar = await cookies();
  for (let index = 0; index < QUICK_ORDER_PREVIEW_MAX_CHUNKS; index += 1) jar.delete(chunkName(index));
}
