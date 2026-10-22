import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T098, FR-039) — a currency a price book uses cannot be
 * deleted, the per-currency base books included: a book denominated in a
 * currency the platform no longer has is not a price book.
 */
describe('price_lists — a currency in use by a price book is not deletable (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;

  const upsertCurrency = (code: string) =>
    api.put(`/api/v1/admin/currencies/${code}`, { label: code, symbol: code, isActive: true });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses while a regular book uses it, and allows it once the book is gone', async () => {
    expect((await upsertCurrency('XBA')).status).toBeLessThan(300);
    const channel = h.em().create(SalesChannel, {
      code: `xba-${Date.now()}`,
      name: { 'en-US': 'XBA shop' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['XBA'],
      defaultCurrency: 'XBA',
    });
    await h.em().persistAndFlush(channel);
    const book = await f.book({ name: 'XBA book', currency: 'XBA', channels: [{ id: channel.id, code: channel.code, defaultCurrency: 'XBA' }], audience: 'everyone', activate: false });
    const refused = await api.delete('/api/v1/admin/currencies/XBA');
    expect(refused.status).toBe(409);
    await api.delete(`/api/v1/admin/price-books/${book.id}`);
    await h.em().nativeDelete(SalesChannel, { id: channel.id });
    const allowed = await api.delete('/api/v1/admin/currencies/XBA');
    expect(allowed.status, allowed.raw).toBe(204);
  });

  it('refuses while a base book uses it', async () => {
    expect((await upsertCurrency('XBC')).status).toBeLessThan(300);
    const base = await api.put(`/api/v1/admin/price-books/base-prices/${f.products.P1.id}`, {
      byCurrency: { XBC: { product: [{ minQuantity: 1, maxQuantity: null, amount: '3' }], variants: {} } },
    });
    expect(base.status, base.raw).toBe(200);
    const refused = await api.delete('/api/v1/admin/currencies/XBC');
    expect(refused.status).toBe(409);
  });
});
