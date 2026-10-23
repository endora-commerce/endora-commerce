import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { BASE_BOOK_ID, seedBasePriceSql, seedBaseTiersSql } from '../../helpers/price-book-sql.js';
import { resolvedPriceEngineSchema } from '@endora-commerce/contracts';

/**
 * Feature 011 / US5 — Storefront resolver endpoint contract (T058).
 *
 * Covers `GET /api/v1/storefront/products/:id/resolved-price`.
 */
describe('Storefront resolver endpoint (feature 011 US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(`truncate table "price_lists" cascade`);

    // SEED_PRODUCT_101's base price in the PLN base book.
    await seedBasePriceSql(h.em(), SEED_PRODUCT_101_ID, '199.0000');
  });

  it('GET /resolved-price returns the resolved price envelope', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`,
      headers: { 'x-sales-channel': channel.code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        resolvedPrice: {
          baseListId: string;
          basePrice: { amount: string; currency: string } | null;
          saleListId: string | null;
          salePrice: unknown;
          displayMode: string;
          currencyCode: string;
          quantityBracket: { minQuantity: number; maxQuantity: number | null } | null;
        };
      };
    };
    expect(body.data.resolvedPrice.baseListId).toBe(BASE_BOOK_ID);
    expect(body.data.resolvedPrice.basePrice?.currency).toBe('PLN');
    expect(Number(body.data.resolvedPrice.basePrice?.amount)).toBe(199);
    expect(body.data.resolvedPrice.saleListId).toBeNull();
    expect(body.data.resolvedPrice.salePrice).toBeNull();
    expect(body.data.resolvedPrice.displayMode).toBe('gross_only');
    expect(body.data.resolvedPrice.currencyCode).toBe('PLN');
    expect(body.data.resolvedPrice.quantityBracket).toEqual({
      minQuantity: 1,
      maxQuantity: null,
    });
    // The wire shape is the contract's.
    expect(resolvedPriceEngineSchema.safeParse(body.data.resolvedPrice).error?.issues ?? []).toEqual([]);
  });

  it('an unpriced product answers the contract’s unpriced shape: nulls, never an empty id', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    // The product's base price (the one row `beforeEach` seeds) goes: nothing prices it.
    await h.em().getConnection().execute(`delete from "price_list_matrix_entries" where "product_id" = ?`, [SEED_PRODUCT_101_ID]);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`,
      headers: { 'x-sales-channel': channel.code },
    });
    expect(res.statusCode).toBe(200);
    const resolved = (res.json() as { data: { resolvedPrice: Record<string, unknown> } }).data.resolvedPrice;
    expect(resolved).toMatchObject({ baseListId: null, basePrice: null, quantityBracket: null, saleListId: null, salePrice: null });
    expect(resolvedPriceEngineSchema.safeParse(resolved).error?.issues ?? []).toEqual([]);
  });

  it('falls back to the system-default channel when the header is absent', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { resolvedPrice: { currencyCode: string } } };
    expect(body.data.resolvedPrice.currencyCode).toBeTruthy();
  });

  it('returns 400 for an unknown X-Sales-Channel code (canonical resolver refuses)', async () => {
    // Feature 053: the pricing route reads the resolved channel; an unknown
    // channel code is refused by the resolver middleware before the handler.
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`,
      headers: { 'x-sales-channel': 'no-such-channel-053' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for an unknown product', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/products/00000000-0000-4000-8000-000000ffffff/resolved-price?quantity=1',
    });
    expect(res.statusCode).toBe(404);
  });

  it('honours the quantity query param for tier selection', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    await seedBaseTiersSql(h.em(), SEED_PRODUCT_101_ID, [
      { minQuantity: 1, maxQuantity: 9, amount: '100' },
      { minQuantity: 10, maxQuantity: null, amount: '90' },
    ]);

    const res1 = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=1`,
      headers: { 'x-sales-channel': channel.code },
    });
    expect(res1.statusCode).toBe(200);
    const b1 = res1.json() as { data: { resolvedPrice: { basePrice: { amount: string } } } };
    expect(Number(b1.data.resolvedPrice.basePrice.amount)).toBe(100);

    const res10 = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price?quantity=10`,
      headers: { 'x-sales-channel': channel.code },
    });
    expect(res10.statusCode).toBe(200);
    const b10 = res10.json() as { data: { resolvedPrice: { basePrice: { amount: string } } } };
    expect(Number(b10.data.resolvedPrice.basePrice.amount)).toBe(90);
  });
});
