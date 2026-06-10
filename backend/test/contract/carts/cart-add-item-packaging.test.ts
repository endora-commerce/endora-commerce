import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 043 — buyer ordering by a packaging unit (US2).
 *
 * Covers:
 *   - the public product detail exposes `packagingUnits`
 *   - POST /api/v1/cart/items with `packagingUnitId` multiplies the quantity
 *     and snapshots the unit (displayName ends with the unit name)
 */
describe('Cart add-item packaging units (043)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createProductWithUnit(suffix: string): Promise<{ productId: string; slug: string; unitId: string }> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `PKGCART-${suffix}`,
        type: 'simple',
        name: { 'en-US': `Pallet product ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: { defaultPrice: 3 },
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(created.statusCode).toBe(201);
    const product = (created.json() as { data: { id: string; slug: string } }).data;

    const unit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/packaging-units`,
      payload: { name: 'Paleta', baseQuantity: 480, isDefault: true },
      cookies: adminCookie,
    });
    expect(unit.statusCode).toBe(201);
    return { productId: product.id, slug: product.slug, unitId: (unit.json() as { data: { id: string } }).data.id };
  }

  it('exposes packagingUnits on the public product detail', async () => {
    // Use a seeded product that is visible on the pl_retail channel.
    const seeded = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products/example-simple-product',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(seeded.statusCode).toBe(200);
    const productId = (seeded.json() as { data: { id: string } }).data.id;

    const unit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/packaging-units`,
      payload: { name: 'PaletaDetail', baseQuantity: 480, isDefault: true },
      cookies: adminCookie,
    });
    expect(unit.statusCode).toBe(201);

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products/example-simple-product',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const detail = (res.json() as { data: { packagingUnits?: Array<{ name: string; baseQuantity: number; isDefault: boolean }> } }).data;
    expect(detail.packagingUnits).toBeDefined();
    expect(detail.packagingUnits?.some((u) => u.name === 'PaletaDetail' && u.baseQuantity === 480 && u.isDefault)).toBe(true);
  });

  it('multiplies quantity and labels the line when ordering a packaging unit', async () => {
    const { productId, unitId } = await createProductWithUnit(`cart-${Date.now()}`);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId, quantity: 2, packagingUnitId: unitId },
    });
    expect(res.statusCode).toBe(200);
    const cart = (res.json() as {
      data: { items: Array<{ quantity: number; packagingUnitName: string | null }> };
    }).data;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.quantity).toBe(960); // 480 × 2
    expect(cart.items[0]!.packagingUnitName).toBe('Paleta');

    // The composed displayName surfaces on the full cart read (which resolves
    // the product name), where the suffix is appended.
    const anon = res.cookies.find((c) => c.name === 'b2b_cart_anon');
    const full = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      ...(anon ? { cookies: { b2b_cart_anon: anon.value } } : {}),
    });
    expect(full.statusCode).toBe(200);
    const fullCart = (full.json() as { data: { items: Array<{ displayName: string | null }> } }).data;
    expect(fullCart.items[0]!.displayName).toMatch(/\(Paleta\)$/);
  });

  it('keeps a packaging-unit line and a single-piece line distinct', async () => {
    const { productId, unitId } = await createProductWithUnit(`mix-${Date.now()}`);
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId, quantity: 1, packagingUnitId: unitId },
    });
    expect(first.statusCode).toBe(200);
    const anonCookie = first.cookies.find((c) => c.name === 'b2b_cart_anon');
    const cookieHeader = anonCookie ? { b2b_cart_anon: anonCookie.value } : {};

    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId, quantity: 5 },
      cookies: cookieHeader,
    });
    expect(second.statusCode).toBe(200);
    const cart = (second.json() as { data: { items: Array<{ quantity: number; packagingUnitName: string | null }> } }).data;
    expect(cart.items).toHaveLength(2);
    const pallet = cart.items.find((i) => i.packagingUnitName === 'Paleta');
    const single = cart.items.find((i) => i.packagingUnitName === null);
    expect(pallet?.quantity).toBe(480);
    expect(single?.quantity).toBe(5);
  });

  it('404s when the packaging unit does not belong to the product', async () => {
    const { productId } = await createProductWithUnit(`nf-${Date.now()}`);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId, quantity: 1, packagingUnitId: '00000000-0000-4000-8000-000000000999' },
    });
    expect(res.statusCode).toBe(404);
  });
});
