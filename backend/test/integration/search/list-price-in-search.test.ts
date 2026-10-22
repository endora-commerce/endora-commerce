import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';

/**
 * Feature 161, G19 (`specs/161-price-book-editor/contracts/backend-gaps.md`,
 * `research.md` R15; vectors D1–D4 of `specs/pricing/worked-examples.md`
 * §10.15) — the Meilisearch-backed listing and the typeahead carry the list
 * price beside a lower buyer price exactly as the catalogue cards do (G14):
 * `ProductSummary.resolvedPrice.listPrice` on a search hit, `listPrice` on a
 * suggestion item. Whether it is present stays the pricing engine's decision.
 *
 * On the seeded product (base 19.99 PLN on `pl_retail`) and the seeded buyer's
 * organization: D1 off → none; D2 on, −5 % → 19.99 beside 18.9905; D3 on,
 * +10 % → none; D4 on, guest → none.
 */
const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('search listing and suggestions carry the list price (161 G19)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let retail: { id: string; code: string; defaultCurrency: string };
  const saved: Record<string, string | undefined> = {};

  const BUYER = { b2b_session: 'stub-customer-session' };
  const CHANNEL = { 'x-sales-channel': 'pl_retail' };
  type Price = { amount: string; currency: string };

  const hit = async (cookies?: Record<string, string>) => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${SEED_PRODUCT_101_SKU}&limit=50`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    const entry = (res.json() as { data: Array<{ id: string; resolvedPrice?: { listPrice?: Price } }> }).data.find((p) => p.id === SEED_PRODUCT_101_ID);
    expect(entry, 'the seeded product is a hit').toBeDefined();
    return entry!.resolvedPrice?.listPrice;
  };
  const suggestion = async (cookies?: Record<string, string>) => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/search/suggest?q=${SEED_PRODUCT_101_SKU}`,
      headers: CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, res.body).toBe(200);
    const item = (res.json() as { data: Array<{ id: string; basePrice?: Price | null; listPrice?: Price }> }).data.find((p) => p.id === SEED_PRODUCT_101_ID);
    expect(item, 'the seeded product is suggested').toBeDefined();
    expect(item!.basePrice, 'the suggestion was priced').toBeDefined();
    return item!.listPrice;
  };
  const showListPrice = (value: boolean) => api.put('/api/v1/admin/price-books/settings/show-list-price', { value });
  const buyerBook = (percent: string) =>
    f.book({ name: `G19 ${percent}`, channels: [retail], audience: { organizations: [{ id: TEST_ORGANIZATION_ID }] }, rows: [{ product: { id: SEED_PRODUCT_101_ID }, percent }] });

  beforeAll(async () => {
    for (const key of ['CATALOG_SEARCH_BACKEND', 'MEILISEARCH_URL', 'MEILISEARCH_API_KEY']) saved[key] = process.env[key];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    const channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    retail = { id: channel.id, code: channel.code, defaultCurrency: channel.defaultCurrency };
    const indexer = new SearchIndexer({ meilisearchHost, meilisearchApiKey: meilisearchKey, attributeRead: h.catalogAttributeRead, ...searchIndexerNeighbourPorts(h) });
    await indexer.reindexChannel(h.em(), channel);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 5 * 60_000);

  afterAll(async () => {
    await showListPrice(false);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await teardownBackendServer(h);
  });

  it('D1 — the setting off: none on the hit or the suggestion', async () => {
    const book = await buyerBook('-5');
    try {
      expect(await hit(BUYER)).toBeUndefined();
      expect(await suggestion(BUYER)).toBeUndefined();
    } finally {
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  }, 60_000);

  it('D2 — on, the buyer pays less: the list price on the hit and on the suggestion', async () => {
    const book = await buyerBook('-5');
    await showListPrice(true);
    try {
      expect(await hit(BUYER)).toEqual({ amount: '19.9900', currency: 'PLN' });
      expect(await suggestion(BUYER)).toEqual({ amount: '19.9900', currency: 'PLN' });
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  }, 60_000);

  it('D3 — on, a surcharge: none', async () => {
    const book = await buyerBook('10');
    await showListPrice(true);
    try {
      expect(await hit(BUYER)).toBeUndefined();
      expect(await suggestion(BUYER)).toBeUndefined();
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  }, 60_000);

  it('D4 — on, a guest: none', async () => {
    const book = await buyerBook('-5');
    await showListPrice(true);
    try {
      expect(await hit()).toBeUndefined();
      expect(await suggestion()).toBeUndefined();
    } finally {
      await showListPrice(false);
      await api.delete(`/api/v1/admin/price-books/${book.id}`);
    }
  }, 60_000);
});
