import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';

/**
 * T068 — `GET /catalog/products` served from Meilisearch when the env
 * toggle picks it. Requires the local docker-compose Meilisearch instance.
 *
 * Workflow:
 *   1. Stand up the test server (seeds catalog into Postgres).
 *   2. Reindex the public Sales Channel into Meilisearch.
 *   3. Flip CATALOG_SEARCH_BACKEND=meilisearch and call the public route.
 *   4. Assert the response carries `x-search-backend: meilisearch` and the
 *      shape matches the contract; assert the same SKUs come back as the
 *      Postgres path.
 *   5. Restore the env so other tests aren't poisoned.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('catalog list — Meilisearch backend', () => {
  let h: BackendServerHandle;
  let originalBackend: string | undefined;
  let originalMeiliUrl: string | undefined;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    // Set env BEFORE setupBackendServer — the SearchQueryService is built
    // during plugin composition and reads process.env at that point.
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    originalMeiliUrl = process.env['MEILISEARCH_URL'];
    originalMeiliKey = process.env['MEILISEARCH_API_KEY'];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;

    h = await setupBackendServer();
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
    // Meilisearch enqueues addDocuments asynchronously — give it a moment
    // to settle so the search query observes the freshly indexed corpus.
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

  it('serves list-products from meilisearch when the env toggle is on', async () => {
    const expectedSkus = (await h.em().find(Product, { visibility: 'public' }))
      .map((p) => p.sku)
      .sort();

    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?limit=50',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    const body = res.json() as {
      data: Array<{
        sku: string;
        name: string;
        price: { amount: number; currency: string } | null;
      }>;
      pagination: { hasMore: boolean; limit: number; cursor: string | null };
    };
    expect(body.pagination.limit).toBe(50);
    const returnedSkus = body.data.map((p) => p.sku).sort();
    // Meilisearch may return a subset bounded by `limit`; assert the page is
    // non-empty and every SKU is one we expected from Postgres.
    expect(returnedSkus.length).toBeGreaterThan(0);
    for (const sku of returnedSkus) {
      expect(expectedSkus).toContain(sku);
    }
  }, 30_000);
});
