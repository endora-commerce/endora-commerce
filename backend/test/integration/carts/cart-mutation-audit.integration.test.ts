import { CartAuditEntry } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';


/**
 * Feature 027 §T035 — `CartService` emits typed audit rows on every
 * mutation (add / update qty / remove). One row per call to
 * `addItem` / `updateItem` / `removeItem` lands in
 * `cart_audit_entries` via the shared `CartAuditService`.
 *
 * Verified end-to-end against the backend test rig — the storefront
 * routes call into CartService, which calls into CartAuditService,
 * which writes both cart_audit_entries + audit_log_entries in one
 * transaction.
 */

describe('cart mutation audit', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes a line_added audit row when an item is added', async () => {
    const anonToken = `anon-audit-add-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(add.statusCode).toBe(200);
    const body = add.json() as { data: { id: string } };
    const cartId = body.data.id;

    const audit = await h.em().find(CartAuditEntry, { cartId });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const added = audit.find((e) => e.action === 'line_added');
    expect(added).toBeDefined();
    expect((added!.metadata as { productId: string }).productId).toBe(
      '00000000-0000-4000-8000-000000000101',
    );
  });

  it('writes a line_qty_changed audit row when an item is updated', async () => {
    const anonToken = `anon-audit-qty-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const cartId = (add.json() as { data: { id: string; items: { id: string }[] } }).data.id;
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 5 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(patch.statusCode).toBe(200);

    const audit = await h.em().find(CartAuditEntry, { cartId });
    const changed = audit.find((e) => e.action === 'line_qty_changed');
    expect(changed).toBeDefined();
    expect((changed!.metadata as { newQuantity: number }).newQuantity).toBe(5);
    expect((changed!.metadata as { oldQuantity: number }).oldQuantity).toBe(1);
  });

  it('writes a line_removed audit row when an item is removed', async () => {
    const anonToken = `anon-audit-rm-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 2 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const cartId = (add.json() as { data: { id: string; items: { id: string }[] } }).data.id;
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemId}`,
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(del.statusCode).toBe(200);

    const audit = await h.em().find(CartAuditEntry, { cartId });
    const removed = audit.find((e) => e.action === 'line_removed');
    expect(removed).toBeDefined();
    expect((removed!.metadata as { quantity: number }).quantity).toBe(2);
  });

  it('writes a line_removed audit row when PATCH sets quantity to 0', async () => {
    const anonToken = `anon-audit-qty-0-${Date.now()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 3 },
      cookies: { b2b_cart_anon: anonToken },
    });
    const cartId = (add.json() as { data: { id: string; items: { id: string }[] } }).data.id;
    const itemId = (add.json() as { data: { items: { id: string }[] } }).data.items[0]!.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      payload: { quantity: 0 },
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(patch.statusCode).toBe(200);

    const audit = await h.em().find(CartAuditEntry, { cartId });
    const removed = audit.find((e) => e.action === 'line_removed');
    expect(removed).toBeDefined();
  });
});
