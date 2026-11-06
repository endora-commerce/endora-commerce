import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  QUICK_ORDER_PREVIEW_COOKIE,
  QUICK_ORDER_PREVIEW_VALUE_MAX,
  packQuickOrderPreview,
  unpackQuickOrderPreview,
  type QuickOrderPreview,
} from '../../lib/quick-order-preview-cookie';

/**
 * Issue #790 — the quick-order preview left the URL. It travels in an httpOnly cookie the
 * storefront writes itself, so a crafted link cannot put a preview (and its raw CSV text) on the
 * page. These are the cookie value's own rules: bound to the session that wrote it, within its
 * size budget, and refused rather than half-read when it does not fit.
 *
 * The budget is the reverse proxy's (architect ruling on PR #805, 2026-11-06): the deployment's
 * nginx runs on default buffers — `large_client_header_buffers 4 8k` refuses a request whose
 * Cookie line passes 8 KB with a 400, and `proxy_buffer_size 4k` turns a response whose headers
 * pass ~4 KB into a 502. One cookie of at most ~3 000 characters leaves room for every other
 * cookie and header on both sides.
 */

/** A uuid as random as a real one (compression is what the budget measures), but stable. */
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

/** The most rows of {@link preview} that still fit the budget. */
function rowsAtTheCap(): number {
  let rows = 1;
  while (packQuickOrderPreview('session-a', preview(rows + 1)) !== null) rows += 1;
  return rows;
}

describe('the quick-order preview cookie (issue #790)', () => {
  it('reads back what it wrote, for the session that wrote it', () => {
    const value = packQuickOrderPreview('session-a', preview(3));
    expect(value).not.toBeNull();
    expect(unpackQuickOrderPreview('session-a', value)).toEqual(preview(3));
  });

  it('is not read for another session', () => {
    const value = packQuickOrderPreview('session-a', preview(3))!;
    expect(unpackQuickOrderPreview('session-b', value)).toBeNull();
  });

  it('a value it did not write reads as no preview', () => {
    expect(unpackQuickOrderPreview('session-a', undefined)).toBeNull();
    expect(unpackQuickOrderPreview('session-a', 'not-a-preview')).toBeNull();
    const json = Buffer.from(JSON.stringify({ recognized: 'x' }), 'utf8').toString('base64url');
    expect(unpackQuickOrderPreview('session-a', json)).toBeNull();
    expect(unpackQuickOrderPreview('session-a', 'A'.repeat(QUICK_ORDER_PREVIEW_VALUE_MAX + 1))).toBeNull();
  });

  it('one cookie whose whole name=value stays within the proxy budget, at the cap', () => {
    const atCap = preview(rowsAtTheCap());
    const value = packQuickOrderPreview('session-a', atCap)!;
    expect(QUICK_ORDER_PREVIEW_VALUE_MAX).toBeLessThanOrEqual(3_000);
    expect(`${QUICK_ORDER_PREVIEW_COOKIE}=${value}`.length).toBeLessThanOrEqual(3_000 + QUICK_ORDER_PREVIEW_COOKIE.length + 1);
    expect(unpackQuickOrderPreview('session-a', value)).toEqual(atCap);
  });

  it('holds a working quick order: at least 40 realistic lines (the measured cap is in PR #805)', () => {
    expect(rowsAtTheCap()).toBeGreaterThanOrEqual(40);
  });

  it('a list too long to carry is refused, not cut', () => {
    expect(packQuickOrderPreview('session-a', preview(rowsAtTheCap() + 1))).toBeNull();
    expect(packQuickOrderPreview('session-a', preview(2000))).toBeNull();
  });
});

/**
 * Architect ruling on PR #805, round 2 (Q1) — the 3 000-character cap was measured safe on
 * nginx's default buffers, which stay the contract; the deployment example adds headroom on top
 * in the storefront's `location`, so a deployment's own extra headers do not eat the margin.
 */
describe('the deployment nginx example gives the storefront header headroom', () => {
  const conf = readFileSync(resolve(import.meta.dirname, '../../../deploy/nginx.example.conf'), 'utf8');
  const storefront = conf.slice(conf.indexOf('# --- Storefront'), conf.indexOf('# --- Admin SPA'));

  it.each(['proxy_buffer_size 16k;', 'proxy_buffers 8 16k;', 'proxy_busy_buffers_size 32k;'])('%s', (directive) => {
    expect(storefront).toContain(directive);
  });

  it('names the preview cookie’s budget beside them', () => {
    expect(storefront).toContain('b2b_quick_order_preview');
    expect(storefront).toContain('3 000');
  });
});
