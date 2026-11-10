import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedBasePriceSql } from '../../helpers/price-book-sql.js';
import { CartItem } from '../../helpers/package-entities.js';
import { LINE_QUANTITY_MAX, expectMergeRefused, expectQuantityRefused } from '../../helpers/line-bounds.js';

/**
 * Issue #351, architect ruling R3 — a cart request that is valid on its own
 * but would leave a line past `LINE_QUANTITY_MAX` is refused with
 * `422 LINE_QUANTITY_EXCEEDED`, `details: { quantity, maximum }`, and writes
 * nothing: an add onto an existing line, and a packaging-unit add whose pieces
 * (`baseQuantity × units`) pass the bound. The cart line edit takes any
 * quantity up to the bound (it stopped at 999) and refuses past it with the
 * translated schema code.
 */
describe('cart — a line never ends past the bound (issue #351, R3)', () => {
  let h: BackendServerHandle;
  const ADMIN = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const anon = (label: string) => ({ b2b_cart_anon: `anon-351-${label}-${Date.now()}` });
  const add = (cookies: Record<string, string>, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h.app.inject({ method: 'POST', url: '/api/v1/cart/items', payload, cookies, headers });
  const linesOf = async (cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart', cookies });
    return (res.json() as { data: { items: Array<{ id: string; quantity: number }> } }).data.items;
  };

  it('refuses an add onto an existing line that would pass the bound; the line is unchanged', async () => {
    const cookies = anon('merge');
    expect((await add(cookies, { productId: SEED_PRODUCT_101_ID, quantity: LINE_QUANTITY_MAX })).statusCode).toBe(200);
    expectMergeRefused(await add(cookies, { productId: SEED_PRODUCT_101_ID, quantity: 1 }), LINE_QUANTITY_MAX + 1);
    expect((await linesOf(cookies)).map((l) => l.quantity)).toEqual([LINE_QUANTITY_MAX]);
  });

  it('answers the refusal in the reader’s language', async () => {
    const cookies = anon('merge-pl');
    expect((await add(cookies, { productId: SEED_PRODUCT_101_ID, quantity: LINE_QUANTITY_MAX })).statusCode).toBe(200);
    const res = await add(cookies, { productId: SEED_PRODUCT_101_ID, quantity: 1 }, { 'accept-language': 'pl' });
    expectMergeRefused(res, LINE_QUANTITY_MAX + 1);
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'Ilość w pozycji może wynosić najwyżej 1 000 000.',
    );
  });

  it('answers the schema refusal in the reader’s language too', async () => {
    const res = await add(anon('schema-pl'), { productId: SEED_PRODUCT_101_ID, quantity: LINE_QUANTITY_MAX + 1 }, {
      'accept-language': 'pl',
    });
    expectQuantityRefused(res, 'quantity');
    expect((res.json() as { error: { message: string } }).error.message).toBe(
      'Ilość w pozycji może wynosić najwyżej 1 000 000.',
    );
  });

  it('refuses a packaging-unit add whose pieces pass the bound, writing nothing', async () => {
    const suffix = `351-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `PKG351-${suffix}`,
        type: 'simple',
        name: `Pallet ${suffix}`,
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const productId = (created.json() as { data: { id: string } }).data.id;
    await seedBasePriceSql(h.em(), productId, '3.00');
    const unit = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/packaging-units`,
      cookies: ADMIN,
      payload: { name: 'Pallet', baseQuantity: 1000 },
    });
    expect(unit.statusCode, unit.body).toBe(201);
    const packagingUnitId = (unit.json() as { data: { id: string } }).data.id;

    const cookies = anon('pkg');
    expectMergeRefused(await add(cookies, { productId, packagingUnitId, quantity: 1001 }), 1_001_000);
    expect(await h.em().fork().count(CartItem, { productId })).toBe(0);
    const ok = await add(cookies, { productId, packagingUnitId, quantity: 1000 });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('a line edit takes quantities past 999 up to the bound, and refuses past it', async () => {
    const cookies = anon('edit');
    expect((await add(cookies, { productId: SEED_PRODUCT_101_ID, quantity: 1 })).statusCode).toBe(200);
    const [line] = await linesOf(cookies);
    const edit = (quantity: number) =>
      h.app.inject({ method: 'PATCH', url: `/api/v1/cart/items/${line!.id}`, cookies, payload: { quantity } });
    const wide = await edit(5000);
    expect(wide.statusCode, wide.body).toBe(200);
    expectQuantityRefused(await edit(LINE_QUANTITY_MAX + 1), 'quantity');
    const atBound = await edit(LINE_QUANTITY_MAX);
    expect(atBound.statusCode, atBound.body).toBe(200);
    expect((await linesOf(cookies)).map((l) => l.quantity)).toEqual([LINE_QUANTITY_MAX]);
  });
});
