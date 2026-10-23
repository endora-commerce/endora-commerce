import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 161, G14 (`specs/161-price-book-editor/contracts/backend-gaps.md`;
 * vectors D1–D4 of `specs/pricing/worked-examples.md` §10.15) — the list price
 * P1 computes (`ListingPriceDetail.listPrice`, G9) reaches the catalogue's own
 * DTOs: `resolvedPrice.listPrice` on every listing card and on the product
 * detail, so the storefront can render "list price / your price" without a
 * second resolution. Whether it is present stays P1's decision: the setting on,
 * and the channel's everyone price above the price charged.
 *
 * The vectors on the seeded product (base 19.99 PLN on `pl_retail`) and the
 * seeded buyer's organization: D1 off → none; D2 on, −5 % → list 19.99 beside
 * 18.99; D3 on, +10 % → none; D4 on, guest → none.
 */
describe('catalogue summaries carry the list price (161 G14)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let retail: { id: string; code: string; defaultCurrency: string };

  const BUYER = { b2b_session: 'stub-customer-session' };
  const CHANNEL = { 'x-sales-channel': 'pl_retail' };
  type Price = { amount: string; currency: string };
  type Summary = {
    id: string;
    price: { amount: number } | null;
    resolvedPrice?: { listPrice?: Price; salePrice?: Price | null; basePrice?: Price | null } | null;
  };

  const listing = async (cookies?: Record<string, string>): Promise<Summary> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${SEED_PRODUCT_101_SKU}`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    const entry = (res.json() as { data: Summary[] }).data.find((p) => p.id === SEED_PRODUCT_101_ID);
    expect(entry, 'the seeded product is on the listing').toBeDefined();
    return entry!;
  };
  const detail = async (cookies?: Record<string, string>): Promise<Summary> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${SEED_PRODUCT_101_ID}`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Summary }).data;
  };
  const showListPrice = (value: boolean) => api.put('/api/v1/admin/price-books/settings/show-list-price', { value });
  const buyerBook = (percent: string) =>
    f.book({
      name: `G14 ${percent}`,
      channels: [retail],
      audience: { organizations: [{ id: TEST_ORGANIZATION_ID }] },
      rows: [{ product: { id: SEED_PRODUCT_101_ID }, percent }],
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    retail = { id: channel.id, code: channel.code, defaultCurrency: channel.defaultCurrency };
  }, 5 * 60_000);

  afterAll(async () => {
    await showListPrice(false);
    await teardownBackendServer(h);
  });

  it('D1 — the setting off: no list price on the card or the product page', async () => {
    const book = await buyerBook('-5');
    try {
      for (const read of [listing, detail]) {
        const summary = await read(BUYER);
        expect(summary.price?.amount).toBe(18.9905);
        expect(summary.resolvedPrice?.listPrice).toBeUndefined();
      }
    } finally {
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  });

  it('D2 — on, the buyer pays less: the list price beside it on the card and on the product page', async () => {
    const book = await buyerBook('-5');
    expect((await showListPrice(true)).status).toBe(200);
    try {
      for (const read of [listing, detail]) {
        const summary = await read(BUYER);
        expect(summary.price?.amount).toBe(18.9905);
        expect(summary.resolvedPrice?.listPrice).toEqual({ amount: '19.9900', currency: 'PLN' });
      }
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  });

  it('D3 — on, a surcharge: no list price', async () => {
    const book = await buyerBook('10');
    await showListPrice(true);
    try {
      for (const read of [listing, detail]) {
        const summary = await read(BUYER);
        expect(summary.price?.amount).toBe(21.989);
        expect(summary.resolvedPrice?.listPrice).toBeUndefined();
      }
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  });

  it('D5 — on, a sale charged below the buyer price: the list price beside the sale (owner ruling 2026-10-23)', async () => {
    const book = await buyerBook('-5');
    const sale = await f.book({
      name: 'G14 sale',
      type: 'sale',
      channels: [retail],
      audience: 'everyone',
      rows: [{ product: { id: SEED_PRODUCT_101_ID }, percent: '-20' }],
    });
    await showListPrice(true);
    try {
      for (const read of [listing, detail]) {
        const summary = await read(BUYER);
        // The sale is charged; the storefront shows it beside the struck list price.
        expect(summary.resolvedPrice?.salePrice).toEqual({ amount: '15.9920', currency: 'PLN' });
        expect(summary.price?.amount).toBe(15.992);
        expect(summary.resolvedPrice?.listPrice).toEqual({ amount: '19.9900', currency: 'PLN' });
      }
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${sale.id}`);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  });

  it('D4 — on, a guest: the list price equals theirs, so none', async () => {
    const book = await buyerBook('-5');
    await showListPrice(true);
    try {
      for (const read of [listing, detail]) {
        const summary = await read();
        expect(summary.price?.amount).toBe(19.99);
        expect(summary.resolvedPrice?.listPrice).toBeUndefined();
      }
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  });
});
