import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import {
  CHANNEL_AMOUNT,
  FALLBACK_ATTRIBUTE_PRICE,
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  ORG_B_AMOUNT,
  ORG_B_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_SKU,
} from '../../helpers/viewer-priced-fixture.js';

/**
 * The same ruling, over the Meilisearch-backed listing.
 *
 * A search document is **shared**: one index per sales channel, one document
 * per product, no organisation anywhere in it. That stays true — this suite
 * asserts that the *price* on a hit is the viewer's while the *document* is
 * everybody's, which is only possible because the hydration pass that already
 * re-reads each hit from Postgres (so a stale index cannot decide what a buyer
 * sees) is also where the price is resolved.
 *
 * The three viewers are the three of `viewer-priced-listing.test.ts`, for the
 * reason stated there; the discriminating case is again the second signed-in
 * buyer, and here it is discriminating twice over — a per-organisation
 * document set would multiply the index by the customer base, and a shared
 * document carrying a price would serve the first buyer's figure to the second.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

interface Summary {
  sku: string;
  price: { amount: number; currency: string } | null;
}

describe('a Meilisearch-backed listing is priced for the viewer', () => {
  let h: BackendServerHandle;
  let originalBackend: string | undefined;
  let originalMeiliUrl: string | undefined;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    originalMeiliUrl = process.env['MEILISEARCH_URL'];
    originalMeiliKey = process.env['MEILISEARCH_API_KEY'];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;

    h = await setupBackendServer();
    await seedViewerPricedFixture(h.em());

    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    const channels = await h.em().find(SalesChannel, {});
    for (const channel of channels) {
      await indexer.reindexChannel(h.em(), channel);
    }
    // Meilisearch enqueues addDocuments asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 60_000);

  afterAll(async () => {
    if (originalBackend === undefined) delete process.env['CATALOG_SEARCH_BACKEND'];
    else process.env['CATALOG_SEARCH_BACKEND'] = originalBackend;
    if (originalMeiliUrl === undefined) delete process.env['MEILISEARCH_URL'];
    else process.env['MEILISEARCH_URL'] = originalMeiliUrl;
    if (originalMeiliKey === undefined) delete process.env['MEILISEARCH_API_KEY'];
    else process.env['MEILISEARCH_API_KEY'] = originalMeiliKey;
    await teardownBackendServer(h);
  });

  async function searched(cookies?: Record<string, string>): Promise<{
    entry: Summary | undefined;
    backend: string | undefined;
    cacheControl: string | undefined;
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}&limit=50`,
      headers: RETAIL_CHANNEL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Summary[] };
    return {
      entry: body.data.find((p) => p.sku === VIEWER_PRICED_SKU),
      backend: res.headers['x-search-backend'] as string | undefined,
      cacheControl: res.headers['cache-control'] as string | undefined,
    };
  }

  it('is served by Meilisearch for every viewer, signed in or not', async () => {
    // Without this the three price assertions below could all be the Postgres
    // fallback, and would say nothing about the search path.
    for (const cookies of [undefined, ORG_A_BUYER, ORG_B_BUYER]) {
      expect((await searched(cookies)).backend).toBe('meilisearch');
    }
  }, 30_000);

  it('quotes an anonymous visitor the channel price', async () => {
    const { entry } = await searched();
    expect(entry?.price).toEqual({ amount: CHANNEL_AMOUNT, currency: 'PLN' });
  }, 30_000);

  it("quotes a signed-in buyer their own organisation's price", async () => {
    const { entry } = await searched(ORG_A_BUYER);
    expect(entry?.price).toEqual({ amount: ORG_A_AMOUNT, currency: 'PLN' });
  }, 30_000);

  it("quotes a buyer of another organisation THEIR price, not the first one's", async () => {
    const { entry } = await searched(ORG_B_BUYER);
    expect(entry?.price).toEqual({ amount: ORG_B_AMOUNT, currency: 'PLN' });
    expect(entry?.price?.amount).not.toBe(ORG_A_AMOUNT);
    expect(entry?.price?.amount).not.toBe(FALLBACK_ATTRIBUTE_PRICE);
  }, 30_000);

  it('leaves the anonymous hit cacheable and marks a personalised one unstorable', async () => {
    expect((await searched()).cacheControl).toBeUndefined();
    expect((await searched(ORG_A_BUYER)).cacheControl).toBe('private, no-store');
  }, 30_000);
});
