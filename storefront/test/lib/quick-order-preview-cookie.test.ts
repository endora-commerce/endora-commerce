import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  QUICK_ORDER_PREVIEW_CHUNK_LIMIT,
  packQuickOrderPreview,
  unpackQuickOrderPreview,
  type QuickOrderPreview,
} from '../../lib/quick-order-preview-cookie';

/**
 * Issue #790 — the quick-order preview left the URL. It travels in an httpOnly cookie the
 * storefront writes itself, so a crafted link cannot put a preview (and its raw CSV text) on the
 * page. These are the cookie value's own rules: bound to the session that wrote it, compact
 * enough to fit, and refused rather than half-read when it does not.
 */

/** A uuid as random as a real one (compression is what the size limit measures), but stable. */
function uuidOf(index: number): string {
  const hex = createHash('sha256').update(String(index)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function preview(rows: number): QuickOrderPreview {
  return {
    recognized: Array.from({ length: rows }, (_, index) => ({
      line: index + 1,
      sku: `SKU-${String(index).padStart(5, '0')}`,
      productId: uuidOf(index),
      variantId: null,
      quantity: index + 1,
    })),
    rejected: [{ line: rows + 1, raw: 'NOPE,1', reason: 'product_not_found' }],
    summary: { recognizedCount: rows, rejectedCount: 1, mergedCount: 0, truncated: false },
  };
}

describe('the quick-order preview cookie (issue #790)', () => {
  it('reads back what it wrote, for the session that wrote it', () => {
    const chunks = packQuickOrderPreview('session-a', preview(3));
    expect(chunks).not.toBeNull();
    expect(unpackQuickOrderPreview('session-a', chunks!)).toEqual(preview(3));
  });

  it('is not read for another session', () => {
    const chunks = packQuickOrderPreview('session-a', preview(3))!;
    expect(unpackQuickOrderPreview('session-b', chunks)).toBeNull();
  });

  it('a value it did not write reads as no preview', () => {
    expect(unpackQuickOrderPreview('session-a', [])).toBeNull();
    expect(unpackQuickOrderPreview('session-a', ['not-a-preview'])).toBeNull();
    const json = Buffer.from(JSON.stringify({ recognized: 'x' }), 'utf8').toString('base64url');
    expect(unpackQuickOrderPreview('session-a', [json])).toBeNull();
  });

  it('a list of 200 lines fits, each chunk under a cookie’s size', () => {
    const chunks = packQuickOrderPreview('session-a', preview(200))!;
    expect(chunks).not.toBeNull();
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(QUICK_ORDER_PREVIEW_CHUNK_LIMIT);
    expect(unpackQuickOrderPreview('session-a', chunks)).toEqual(preview(200));
  });

  it('a list too long to carry is refused, not cut', () => {
    expect(packQuickOrderPreview('session-a', preview(2000))).toBeNull();
  });
});
