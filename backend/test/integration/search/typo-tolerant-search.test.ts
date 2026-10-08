import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import { SEED_PRODUCT_101_SKU } from '../../helpers/seed-catalog.js';

/**
 * A misspelled search finds what the correctly spelled one finds — on the
 * results page, not only in the typeahead popup.
 *
 * The owner's report was "the search does not take typos into account". The
 * index was never the cause: Meilisearch's typo tolerance is on by default and
 * this module switches none of it off. What defeated it was the route. The
 * storefront's `/search` page reads `GET /api/v1/catalog/products?q=…`, and
 * that listing asked Postgres — `sku ILIKE '%…%'` — unless
 * `CATALOG_SEARCH_BACKEND=meilisearch` was set, which nothing this repository
 * ships sets. The popup beside it reads the index unconditionally, so one
 * search box offered a product for `simpel` and reported no results for it on
 * Enter.
 *
 * So this file runs with the variable **unset**, which is the state of a
 * default instance and the only state in which the assertion means anything.
 * The harness pins `postgres` for every other file (`global-setup.ts` says
 * why), hence the `delete` rather than an assumption.
 *
 * `x-search-backend` is asserted beside every hit: a correctly spelled phrase
 * is found by both backends, so the hit alone cannot tell the engine from its
 * fallback.
 *
 * The misspellings are of `simple`, which the seeded product carries in its
 * SKU (`EXAMPLE-SIMPLE-001`) and in its English name, so the test does not
 * depend on which language the channel's documents were built in. Each is one
 * edit away and leaves the first letter alone — Meilisearch counts a typo on
 * the first character as two, and allows one for a word of five to eight.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

const RETAIL_CHANNEL = { 'x-sales-channel': 'pl_retail' };

const MISSPELLINGS = [
  { phrase: 'simpel', what: 'two letters transposed' },
  { phrase: 'simle', what: 'a letter missing' },
  { phrase: 'simqle', what: 'a wrong letter' },
  { phrase: 'simpple', what: 'a letter doubled' },
];

describe('a misspelled search phrase still finds the product', () => {
  let h: BackendServerHandle;
  let originalBackend: string | undefined;
  let originalMeiliUrl: string | undefined;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    originalMeiliUrl = process.env['MEILISEARCH_URL'];
    originalMeiliKey = process.env['MEILISEARCH_API_KEY'];
    delete process.env['CATALOG_SEARCH_BACKEND'];
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

  async function resultsPage(phrase: string): Promise<{ skus: string[]; backend: unknown }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?limit=50&q=${encodeURIComponent(phrase)}`,
      headers: RETAIL_CHANNEL,
    });
    expect(res.statusCode, phrase).toBe(200);
    const body = res.json() as { data: Array<{ sku: string }> };
    return { skus: body.data.map((p) => p.sku), backend: res.headers['x-search-backend'] };
  }

  async function popup(phrase: string): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/search/suggest?q=${encodeURIComponent(phrase)}`,
      headers: RETAIL_CHANNEL,
    });
    expect(res.statusCode, phrase).toBe(200);
    return (res.json() as { data: Array<{ sku: string }> }).data.map((p) => p.sku);
  }

  it('finds the product under its correct spelling, from the index', async () => {
    // The control: without it a misspelling that finds nothing could be a
    // fixture the index never held.
    const page = await resultsPage('simple');
    expect(page.backend).toBe('meilisearch');
    expect(page.skus).toContain(SEED_PRODUCT_101_SKU);
  }, 30_000);

  it.each(MISSPELLINGS)(
    'finds it on the results page with $what ("$phrase")',
    async ({ phrase }) => {
      const page = await resultsPage(phrase);
      expect(
        page.backend,
        'the results page was answered by the substring match, which tolerates no typo',
      ).toBe('meilisearch');
      expect(page.skus).toContain(SEED_PRODUCT_101_SKU);
    },
    30_000,
  );

  it.each(MISSPELLINGS)(
    'finds it in the typeahead popup with $what ("$phrase")',
    async ({ phrase }) => {
      expect(await popup(phrase)).toContain(SEED_PRODUCT_101_SKU);
    },
    30_000,
  );

  it('does not find it once a deployment pins the database', async () => {
    // What the report described, kept as the stated cost of the explicit
    // override rather than as a defect: Postgres matches a substring.
    process.env['CATALOG_SEARCH_BACKEND'] = 'postgres';
    try {
      const exact = await resultsPage('simple');
      expect(exact.backend).toBe('postgres');
      expect(exact.skus).toContain(SEED_PRODUCT_101_SKU);

      const misspelled = await resultsPage('simpel');
      expect(misspelled.backend).toBe('postgres');
      expect(misspelled.skus).not.toContain(SEED_PRODUCT_101_SKU);
    } finally {
      delete process.env['CATALOG_SEARCH_BACKEND'];
    }
  }, 30_000);
});
