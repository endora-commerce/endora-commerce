import { Meilisearch } from 'meilisearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  SearchIndexer,
  SORTABLE_ATTRIBUTES,
} from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import {
  SEED_PRODUCT_101_SKU,
  SEED_PRODUCT_102_SKU,
  SEED_PRODUCT_103_SKU,
} from '../../helpers/seed-catalog.js';

/**
 * Issue #287 — the three non-relevance sorts, actually served by Meilisearch.
 *
 * `x-search-backend` is the load-bearing assertion in every case below. The
 * order alone proves nothing: Postgres answers all four sorts, so a listing
 * that fell back would come back correctly ordered and only the header would
 * say it had been re-run against the database the index exists to spare. That
 * is precisely what was happening — `sortableAttributes` was `[]`, the engine
 * answered `invalid_search_sort`, and the unreachable-index fallback quietly
 * paid for a Postgres query on every sorted page.
 *
 * Requires the local docker-compose Meilisearch and Postgres.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

/**
 * The three seeded products in ascending order of the name the index carries
 * for this channel.
 *
 * That name is the channel's own default language — `pl_retail` resolves
 * `pl-PL` — which is also the language the response renders, so the order a
 * buyer sees is the order they were sorted by. Ascending, the three documents
 * read:
 *
 *   1. `Przykładowy duży produkt`
 *   2. `Przykładowy produkt niebieski`
 *   3. `Przykładowy produkt prosty`
 *
 * Meilisearch's string ordering is case-insensitive and folds diacritics, but
 * nothing here turns on that: the first difference between these three is
 * `duży` against `produkt`.
 */
const ASCENDING_BY_NAME = [
  SEED_PRODUCT_103_SKU,
  SEED_PRODUCT_102_SKU,
  SEED_PRODUCT_101_SKU,
];

describe('catalog list — sorted on the Meilisearch backend', () => {
  let h: BackendServerHandle;
  let indexUid: string;
  let originalBackend: string | undefined;
  let originalMeiliUrl: string | undefined;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    // Set env BEFORE setupBackendServer — SearchQueryService is built during
    // composition and reads process.env at that point.
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
      const summary = await indexer.reindexChannel(h.em(), channel);
      if (channel.code === 'pl_retail') indexUid = summary.indexUid;
    }
    // Meilisearch settles `addDocuments` asynchronously — the reindex awaits
    // the document task, this covers the search-visibility lag behind it.
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

  async function listSortedBy(sort: string): Promise<{ backend: string; skus: string[] }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?limit=50&sort=${encodeURIComponent(sort)}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ sku: string }> };
    return {
      backend: String(res.headers['x-search-backend']),
      skus: body.data.map((p) => p.sku),
    };
  }

  it('declares the sortable attributes on the channel index', async () => {
    const client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });
    const settings = await client.index(indexUid).getSettings();
    expect([...(settings.sortableAttributes ?? [])].sort()).toEqual(
      [...SORTABLE_ATTRIBUTES].sort(),
    );
  });

  it('serves sort=name from Meilisearch, ascending', async () => {
    const { backend, skus } = await listSortedBy('name');
    expect(backend).toBe('meilisearch');
    expect(skus.filter((s) => ASCENDING_BY_NAME.includes(s))).toEqual(ASCENDING_BY_NAME);
  });

  it('serves sort=-name from Meilisearch, descending', async () => {
    const { backend, skus } = await listSortedBy('-name');
    expect(backend).toBe('meilisearch');
    expect(skus.filter((s) => ASCENDING_BY_NAME.includes(s))).toEqual(
      [...ASCENDING_BY_NAME].reverse(),
    );
  });

  it('serves sort=-createdAt from Meilisearch, newest first', async () => {
    const { backend, skus } = await listSortedBy('-createdAt');
    expect(backend).toBe('meilisearch');

    // Ties are legitimate — the fixture inserts its products in one flush —
    // so the assertion is that the sequence never climbs, which is what
    // "newest first" claims and what the Postgres backend of the same route
    // answers.
    const createdAtBySku = new Map(
      (await h.em().find(Product, {})).map((p) => [p.sku, p.createdAt.getTime()]),
    );
    const returned = skus.map((sku) => createdAtBySku.get(sku));
    expect(returned.every((v) => typeof v === 'number')).toBe(true);
    for (let i = 1; i < returned.length; i += 1) {
      expect(returned[i]!).toBeLessThanOrEqual(returned[i - 1]!);
    }
  });

  it('serves relevance from Meilisearch — it never needed a sortable attribute', async () => {
    const { backend } = await listSortedBy('relevance');
    expect(backend).toBe('meilisearch');
  });

  it('indexes no top-level `price`, and loses nothing by it', async () => {
    // The field mirrored `attributes.defaultPrice` — a legacy catalogue
    // attribute, not any price list's figure — was read by nothing on the
    // query path, and was named exactly what a price sort would reach for.
    // The attribute it was copied from is still indexed and still filterable.
    const client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });
    const docs = await client.index(indexUid).getDocuments<{
      sku: string;
      attributes: Record<string, unknown>;
    }>({ limit: 100 });
    expect(docs.results.length).toBeGreaterThan(0);
    for (const doc of docs.results) {
      expect(doc).not.toHaveProperty('price');
    }
    const seeded = docs.results.find((d) => d.sku === SEED_PRODUCT_101_SKU);
    expect(seeded?.attributes['defaultPrice']).toBe(19.99);
  });
});
