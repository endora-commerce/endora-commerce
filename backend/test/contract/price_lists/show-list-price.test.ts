import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 160 (G8, G9 of `specs/161-price-book-editor/`; owner ruling Q8a, N4,
 * vectors D1–D4 of `specs/pricing/worked-examples.md` §10.15) — the
 * *show list price* setting: off by default, written through one audited
 * command, and when on the listing detail carries the catalogue price as
 * `listPrice` only where it is above the price charged.
 */
describe('show list price (feature 160, G8/G9)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;

  const detail = async (organization: PricingFixture['orgs']['Acme'] | null) => {
    const answer = await f.pricing.resolveListingPriceDetails({
      products: [f.products.P1],
      context: {
        salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' },
        ...(organization ? { organization } : {}),
      },
    });
    return answer.get(f.products.P1.id)!;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('D1 — off by default: no list price', async () => {
    const book = await f.book({ name: 'E3', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-5' }] });
    const res = await api.get<{ data: { value: boolean } }>('/api/v1/admin/price-books/settings/show-list-price');
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data.value).toBe(false);
    const d1 = await detail(f.orgs.Acme);
    expect(d1.price).toMatchObject({ amount: '95.0000' });
    expect(d1.listPrice).toBeUndefined();
    await api.delete(`/api/v1/admin/price-books/${book.id}`);
  });

  it('D2–D4 — on: the list price beside a lower buyer price, never beside a higher or equal one', async () => {
    const before = await h.em().count(AuditLogEntry, { action: 'price_list.show_list_price_set' });
    const on = await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: true });
    expect(on.status, on.raw).toBe(200);
    expect(await h.em().count(AuditLogEntry, { action: 'price_list.show_list_price_set' })).toBe(before + 1);
    try {
      const lower = await f.book({ name: 'E3 on', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-5' }] });
      const d2 = await detail(f.orgs.Acme);
      expect(d2.price).toMatchObject({ amount: '95.0000' });
      expect(d2.listPrice).toEqual({ amount: '100.0000', currency: 'PLN' });
      await api.delete(`/api/v1/admin/price-books/${lower.id}`);

      const surcharge = await f.book({ name: 'U2.1', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '10' }] });
      const d3 = await detail(f.orgs.Acme);
      expect(d3.price).toMatchObject({ amount: '110.0000' });
      expect(d3.listPrice).toBeUndefined();
      await api.delete(`/api/v1/admin/price-books/${surcharge.id}`);

      const d4 = await detail(null);
      expect(d4.price).toMatchObject({ amount: '100.0000' });
      expect(d4.listPrice).toBeUndefined();
    } finally {
      await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: false });
    }
  });

  it('G9 — the storefront resolved price carries the list price for a signed-in buyer paying less', async () => {
    const retail = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const book = await f.book({
      name: 'Retail terms',
      channels: [{ id: retail.id, code: retail.code, defaultCurrency: retail.defaultCurrency }],
      audience: { organizations: [{ id: TEST_ORGANIZATION_ID }] },
      rows: [{ product: { id: SEED_PRODUCT_101_ID }, percent: '-10' }],
    });
    const read = (cookies?: Record<string, string>) =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/storefront/products/${SEED_PRODUCT_101_ID}/resolved-price`,
        headers: { 'x-sales-channel': 'pl_retail' },
        ...(cookies ? { cookies } : {}),
      });
    type Resolved = { data: { resolvedPrice: { listPrice?: { amount: string; currency: string } } } };
    await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: true });
    try {
      const signedIn = await read({ b2b_session: 'stub-customer-session' });
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      expect((signedIn.json() as Resolved).data.resolvedPrice.listPrice).toEqual({ amount: '19.9900', currency: 'PLN' });
      const guest = await read();
      expect((guest.json() as Resolved).data.resolvedPrice.listPrice).toBeUndefined();
    } finally {
      await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: false });
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
    const off = await read({ b2b_session: 'stub-customer-session' });
    expect((off.json() as Resolved).data.resolvedPrice.listPrice).toBeUndefined();
  });

  it('refuses a non-boolean', async () => {
    expect((await api.put('/api/v1/admin/price-books/settings/show-list-price', { value: 'yes' })).status).toBe(400);
  });
});
