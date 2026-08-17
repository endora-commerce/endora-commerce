import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

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
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();

    // Ensure SEED_PRODUCT_101 has a Default bracket.
    const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '199.0000' }],
    });
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
    expect(body.data.resolvedPrice.baseListId).toBe(DEFAULT_PRICE_LIST_ID);
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

  it('honours the quantity query param for bracket selection', async () => {
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    const svc = new PriceListService(h.em, undefined, undefined, undefined, neighbourReadPorts(h.em));
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, SEED_PRODUCT_101_ID, {
      PLN: [
        { minQuantity: 1, maxQuantity: 9, amount: '100' },
        { minQuantity: 10, maxQuantity: null, amount: '90' },
      ],
    });

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
