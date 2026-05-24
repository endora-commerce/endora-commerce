import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ProductLink } from '../../../src/modules/catalog/entities/product-link.entity.js';
import {
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';

/**
 * T028 (feature 027 US1) — GET /api/v1/cart/upsells full coverage.
 *
 * Seeds `product_links` rows (kind = 'up_sell') and exercises:
 *   - empty cart → empty data
 *   - one source line → one target
 *   - two source lines pointing at the same target → matchCount=2
 *   - target already in the cart → excluded
 *   - limit=1 returns at most one
 */

describe('GET /api/v1/cart/upsells', () => {
  let h: BackendServerHandle;
  let createdLinkIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(() => {
    createdLinkIds = [];
  });

  afterEach(async () => {
    if (createdLinkIds.length > 0) {
      const em = h.em();
      await em.nativeDelete(ProductLink, { id: { $in: createdLinkIds } });
    }
  });

  async function seedUpsell(sourceId: string, targetId: string): Promise<void> {
    const em = h.em();
    const link = em.create(ProductLink, {
      sourceProductId: sourceId,
      targetProductId: targetId,
      kind: 'up_sell',
    });
    await em.persistAndFlush(link);
    createdLinkIds.push(link.id);
  }

  it('returns an empty data array on an empty cart', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/cart/upsells' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it('returns the up-sell target for a cart with one source line', async () => {
    await seedUpsell(SEED_PRODUCT_101_ID, SEED_PRODUCT_103_ID);

    const anonToken = `anon-upsell-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart/upsells',
      cookies: { b2b_cart_anon: anonToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ productId: string; matchCount: number }> };
    expect(body.data.find((d) => d.productId === SEED_PRODUCT_103_ID)).toBeDefined();
    expect(body.data.find((d) => d.productId === SEED_PRODUCT_103_ID)?.matchCount).toBe(1);
  });

  it('aggregates matchCount when two source lines point at the same target', async () => {
    await seedUpsell(SEED_PRODUCT_101_ID, SEED_PRODUCT_103_ID);
    await seedUpsell(SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID);

    const anonToken = `anon-upsell-agg-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_102_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart/upsells',
      cookies: { b2b_cart_anon: anonToken },
    });
    const body = res.json() as { data: Array<{ productId: string; matchCount: number }> };
    const hit = body.data.find((d) => d.productId === SEED_PRODUCT_103_ID);
    expect(hit).toBeDefined();
    expect(hit?.matchCount).toBe(2);
  });

  it('excludes a target product that is already in the cart', async () => {
    await seedUpsell(SEED_PRODUCT_101_ID, SEED_PRODUCT_103_ID);

    const anonToken = `anon-upsell-exclude-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });
    // Add the up-sell target to the cart too.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_103_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart/upsells',
      cookies: { b2b_cart_anon: anonToken },
    });
    const body = res.json() as { data: Array<{ productId: string }> };
    expect(body.data.find((d) => d.productId === SEED_PRODUCT_103_ID)).toBeUndefined();
  });

  it('respects the limit query parameter', async () => {
    await seedUpsell(SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID);
    await seedUpsell(SEED_PRODUCT_101_ID, SEED_PRODUCT_103_ID);

    const anonToken = `anon-upsell-limit-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
      cookies: { b2b_cart_anon: anonToken },
    });

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart/upsells?limit=1',
      cookies: { b2b_cart_anon: anonToken },
    });
    const body = res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });
});
