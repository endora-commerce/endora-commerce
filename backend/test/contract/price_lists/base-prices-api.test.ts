import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T091) — the product editor's base-price endpoints: one
 * read per product across currencies with each variant's row, and one audited
 * write across currencies that creates a currency's base book on first use
 * (FR-009).
 */
describe('admin base-price endpoints (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;

  type BaseRead = {
    productId: string;
    byCurrency: Record<
      string,
      {
        bookId: string;
        product: Array<{ minQuantity: number; maxQuantity: number | null; amount: string }>;
        variants: Record<string, null | { type: string; tiers?: unknown[]; percent?: string; amount?: string }>;
      }
    >;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reads a product’s base price per currency, with every variant’s row', async () => {
    const res = await api.get<{ data: BaseRead }>(`/api/v1/admin/price-books/base-prices?productId=${f.products.P5.id}`);
    expect(res.status, res.raw).toBe(200);
    const pln = res.body.data.byCurrency['PLN']!;
    expect(pln.product).toEqual([{ minQuantity: 1, maxQuantity: null, amount: '80.0000' }]);
    expect(pln.variants[f.variants.P5r]).toEqual({ type: 'percent', percent: '10.00' });
    expect(pln.variants[f.variants.P5b]).toBeNull();
  });

  it('writes two currencies in one audited command, creating the EUR base book on first use', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'price_list.base_prices_set' });
    const res = await api.put<{ data: BaseRead }>(`/api/v1/admin/price-books/base-prices/${f.products.P5.id}`, {
      byCurrency: {
        PLN: {
          product: [
            { minQuantity: 1, maxQuantity: 9, amount: '82' },
            { minQuantity: 10, maxQuantity: null, amount: '78' },
          ],
          variants: { [f.variants.P5r]: { type: 'amount', amount: '5' }, [f.variants.P5b]: null },
        },
        EUR: {
          product: [{ minQuantity: 1, maxQuantity: null, amount: '19' }],
          variants: { [f.variants.P5b]: { type: 'fixed', tiers: [{ minQuantity: 1, maxQuantity: null, amount: '18' }] } },
        },
      },
    });
    expect(res.status, res.raw).toBe(200);
    expect(await h.em().count(AuditLogEntry, { action: 'price_list.base_prices_set' })).toBe(before + 1);
    expect(Object.keys(res.body.data.byCurrency).sort()).toEqual(['EUR', 'PLN']);
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5r, quantity: 10 })).toBe('83.0000');
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5b, channel: f.channels.CH3, currency: 'EUR' })).toBe('18.0000');
    await f.resetBase();
  });

  it('refuses a variant of another product and an unknown product', async () => {
    const res = await api.put(`/api/v1/admin/price-books/base-prices/${f.products.P1.id}`, {
      byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '1' }], variants: { [f.variants.P5r]: null } } },
    });
    expect(res.status).toBe(400);
    const missing = await api.put(`/api/v1/admin/price-books/base-prices/00000000-0000-4000-8000-0000001600bb`, {
      byCurrency: { PLN: { product: [], variants: {} } },
    });
    expect(missing.status).toBe(404);
  });
});
