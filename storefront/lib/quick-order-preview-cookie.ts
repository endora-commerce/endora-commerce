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
 * carried, deflated, bound to the session that wrote it, and dropped once the build succeeds or
 * the session ends.
 *
 * **The size budget is the reverse proxy's** (architect ruling on PR #805, 2026-11-06). The
 * deployment's nginx (`deploy/nginx.example.conf`) runs on default buffers:
 * `large_client_header_buffers 4 8k` answers a request whose Cookie line passes 8 KB with a 400,
 * and `proxy_buffer_size 4k` turns an upstream response whose headers pass ~4 KB into a 502. A
 * preview over either would lock the buyer out of the whole storefront until the cookie expired.
 * So it is **one** cookie whose value is at most {@link QUICK_ORDER_PREVIEW_VALUE_MAX} characters;
 * a preview that does not fit is refused (`packQuickOrderPreview` returns `null`) and the page
 * says so, rather than writing it or showing it cut short. The defaults stay the contract: the
 * example config adds larger proxy buffers as a safety margin only (round 2 of the ruling), and
 * that margin does not raise this cap.
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
    /**
     * After a partial cart build: why the cart did not take this line (feature 155, FR-011 (b)),
     * with the build's product and unit names cut to `REPORT_NAME_MAX`. The server writes them
     * here; they never travel in a URL (issue #790).
     */
    notAdded?: {
      kind: 'pieces' | 'packaging_unit';
      minimum: number;
      productName: string;
      packagingUnitName?: string;
    };
  }>;
  rejected: RejectedQuickOrderItem[];
  summary: { recognizedCount: number; rejectedCount: number; mergedCount: number; truncated: boolean };
}

export const QUICK_ORDER_PREVIEW_COOKIE = 'b2b_quick_order_preview';
/** The longest cookie value written or read — see the budget above. */
export const QUICK_ORDER_PREVIEW_VALUE_MAX = 3_000;
/** Long enough to review a pasted list; the preview is a step, not a draft. */
const MAX_AGE_SECONDS = 60 * 60;

/** Which session wrote the value — a digest, so the cookie never repeats the session id. */
function sessionTag(sessionCookie: string): string {
  return createHash('sha256').update(sessionCookie).digest('base64url').slice(0, 22);
}

/** The cookie value for `preview`, or `null` when it is too long to carry. */
export function packQuickOrderPreview(sessionCookie: string, preview: QuickOrderPreview): string | null {
  const json = JSON.stringify({ s: sessionTag(sessionCookie), p: preview });
  const value = deflateRawSync(Buffer.from(json, 'utf8')).toString('base64url');
  return value.length <= QUICK_ORDER_PREVIEW_VALUE_MAX ? value : null;
}

/** The preview `value` holds for this session, or `null` for anything else. */
export function unpackQuickOrderPreview(sessionCookie: string, value: string | null | undefined): QuickOrderPreview | null {
  if (!value || value.length > QUICK_ORDER_PREVIEW_VALUE_MAX) return null;
  try {
    const json = inflateRawSync(Buffer.from(value, 'base64url')).toString('utf8');
    const parsed = JSON.parse(json) as { s?: unknown; p?: Partial<QuickOrderPreview> };
    if (parsed.s !== sessionTag(sessionCookie)) return null;
    const preview = parsed.p;
    if (!preview || !Array.isArray(preview.recognized) || !Array.isArray(preview.rejected)) return null;
    if (typeof preview.summary !== 'object' || preview.summary === null) return null;
    return preview as QuickOrderPreview;
  } catch {
    return null;
  }
}

export async function readQuickOrderPreview(sessionCookie: string): Promise<QuickOrderPreview | null> {
  const jar = await cookies();
  return unpackQuickOrderPreview(sessionCookie, jar.get(QUICK_ORDER_PREVIEW_COOKIE)?.value);
}

/** Writes the preview; `false` when it is too long to carry (and nothing is written). */
export async function writeQuickOrderPreview(sessionCookie: string, preview: QuickOrderPreview): Promise<boolean> {
  const value = packQuickOrderPreview(sessionCookie, preview);
  if (value === null) return false;
  const jar = await cookies();
  jar.set(QUICK_ORDER_PREVIEW_COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: MAX_AGE_SECONDS,
  });
  return true;
}

export async function clearQuickOrderPreview(): Promise<void> {
  const jar = await cookies();
  jar.delete(QUICK_ORDER_PREVIEW_COOKIE);
}
