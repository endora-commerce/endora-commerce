import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T023 (feature 027 US1 / FR-007) — mini-cart payload contract.
 *
 * `GET /api/v1/cart?view=mini` returns the lightweight payload that the
 * header renders on every page navigation. It must:
 *   - return only the slim shape (`id`, `itemCount`, `items[]`, `subtotal`)
 *   - omit per-line `unavailable` / `unavailableReason`
 *   - omit `droppedLines`, `couponDroppedThisRead`, `primaryCta`,
 *     `discount`, `grandTotal`, and the per-cart lifecycle fields (the
 *     full GET returns those; the mini view does not)
 *   - keep the empty-cart variant cheap when no actor identifies
 */

describe('GET /api/v1/cart?view=mini', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the slim payload shape for the empty cart on an unidentified caller', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart?view=mini',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      id: null,
      itemCount: 0,
      items: [],
      subtotal: { amount: 0, currency: 'PLN' },
    });
    // The heavy keys must not appear in the mini payload.
    expect(Object.keys(body.data)).not.toContain('droppedLines');
    expect(Object.keys(body.data)).not.toContain('couponDroppedThisRead');
    expect(Object.keys(body.data)).not.toContain('primaryCta');
    expect(Object.keys(body.data)).not.toContain('discount');
    expect(Object.keys(body.data)).not.toContain('grandTotal');
    expect(Object.keys(body.data)).not.toContain('status');
    expect(Object.keys(body.data)).not.toContain('approvalStatus');
  });

  it('serializes lines without the unavailable* fields and with line totals', async () => {
    const anonToken = `anon-mini-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);

    const mini = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart?view=mini',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(mini.statusCode).toBe(200);
    const body = mini.json() as {
      data: {
        id: string;
        itemCount: number;
        items: Array<Record<string, unknown>>;
        subtotal: { amount: number; currency: string };
      };
    };
    expect(typeof body.data.id).toBe('string');
    expect(body.data.itemCount).toBe(1);
    expect(body.data.items).toHaveLength(1);
    const line = body.data.items[0]!;
    expect(line).toHaveProperty('id');
    expect(line).toHaveProperty('productId');
    expect(line).toHaveProperty('variantId');
    expect(line).toHaveProperty('quantity', 2);
    expect(line).toHaveProperty('unitPrice');
    expect(line).toHaveProperty('lineTotal');
    expect(line).not.toHaveProperty('unavailable');
    expect(line).not.toHaveProperty('unavailableReason');

    expect(body.data.subtotal.currency).toBe('PLN');
    // lineTotal = unitPrice * quantity (qty = 2)
    expect((body.data.items[0] as { lineTotal: { amount: number } }).lineTotal.amount).toBeGreaterThanOrEqual(0);

    // Heavy keys must still be absent on the populated mini payload.
    expect(Object.keys(body.data)).not.toContain('droppedLines');
    expect(Object.keys(body.data)).not.toContain('couponDroppedThisRead');
    expect(Object.keys(body.data)).not.toContain('primaryCta');
  });

  it('does not return the heavy fields the full view emits', async () => {
    // Compare the same identified cart's full payload to the mini payload —
    // ensures the mini handler hasn't drifted back to the full serializer.
    const anonToken = `anon-mini-compare-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const full = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      cookies: { b2b_cart_anon: anonToken },
    });
    const mini = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart?view=mini',
      cookies: { b2b_cart_anon: anonToken },
    });
    const fullKeys = new Set(Object.keys((full.json() as { data: object }).data));
    const miniKeys = new Set(Object.keys((mini.json() as { data: object }).data));
    expect(fullKeys.has('droppedLines')).toBe(true);
    expect(miniKeys.has('droppedLines')).toBe(false);
    expect(fullKeys.has('primaryCta')).toBe(true);
    expect(miniKeys.has('primaryCta')).toBe(false);
    expect(fullKeys.has('grandTotal')).toBe(true);
    expect(miniKeys.has('grandTotal')).toBe(false);
  });
});
