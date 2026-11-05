import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { createAttributeFixture } from '../../helpers/seed-catalog.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';

/**
 * Issue #684 — `filter[attr.<multiselect>]=<option>` on the Meilisearch backend
 * answers the products whose multiselect holds that option.
 *
 * The indexer stored a multiselect as its JSON text (`"[\"s-146\"]"`), which
 * no `attributes.series = "s-146"` filter can match, so the listing answered
 * `[]` while the Postgres backend answered the products. The document now holds
 * the options as an array, and Meilisearch matches an array field when any
 * element equals the value. Several requested values for one key stay OR-ed.
 *
 * Requires the local Meilisearch, as `catalog-via-meilisearch.test.ts` does.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

const KEY = 'i684_series';
const SKU_PREFIX = 'I684-';
const PRODUCTS: ReadonlyArray<{ sku: string; series: string[] }> = [
  { sku: `${SKU_PREFIX}ONE`, series: ['s-146'] },
  { sku: `${SKU_PREFIX}BOTH`, series: ['s-146', 's-200'] },
  { sku: `${SKU_PREFIX}OTHER`, series: ['s-200'] },
  { sku: `${SKU_PREFIX}NONE`, series: [] },
];

describe('catalog list — a multiselect attribute filter on the Meilisearch backend (issue #684)', () => {
  let h: BackendServerHandle;
  let originalBackend: string | undefined;
  let originalMeiliUrl: string | undefined;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    // Before setupBackendServer: the query service reads the toggle at composition.
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    originalMeiliUrl = process.env['MEILISEARCH_URL'];
    originalMeiliKey = process.env['MEILISEARCH_API_KEY'];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;

    h = await setupBackendServer();
    const em = h.em();
    await createAttributeFixture(em, {
      key: KEY,
      label: { 'en-US': 'Series' },
      labelDefault: 'Series',
      valueType: 'multiselect',
      isFilterable: true,
      options: ['s-146', 's-200'].map((value) => ({ value, sortOrder: 0 })),
    });

    const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
    expect(retail, 'the harness seeds pl_retail').not.toBeNull();
    const products = PRODUCTS.map((p) =>
      em.create(Product, {
        sku: p.sku,
        slug: p.sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: `Issue 684 ${p.sku}`,
        description: 'Multiselect filter fixture.',
        visibility: 'public',
        attributeValues: { [KEY]: p.series },
      }),
    );
    await em.persistAndFlush(products);
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values ` +
        products.map(() => '(?,?)').join(','),
      products.flatMap((p) => [retail!.id, p.id]),
    );

    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    for (const channel of await h.em().find(SalesChannel, {})) {
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

  async function skusFor(wanted: string[]): Promise<string[]> {
    const query = wanted.map((v) => `filter%5Battr.${KEY}%5D=${encodeURIComponent(v)}`).join('&');
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?limit=50&${query}`,
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    const body = res.json() as { data: Array<{ sku: string }> };
    return body.data.map((p) => p.sku).sort();
  }

  const expected = (wanted: string[]): string[] =>
    PRODUCTS.filter((p) => p.series.some((option) => wanted.includes(option)))
      .map((p) => p.sku)
      .sort();

  it('answers every product whose multiselect holds the requested option', async () => {
    expect(await skusFor(['s-146'])).toEqual(expected(['s-146']));
    expect(await skusFor(['s-200'])).toEqual(expected(['s-200']));
    expect(expected(['s-146'])).toEqual([`${SKU_PREFIX}BOTH`, `${SKU_PREFIX}ONE`]);
  });

  it('ORs several requested values for one key', async () => {
    expect(await skusFor(['s-146', 's-200'])).toEqual(expected(['s-146', 's-200']));
    expect(expected(['s-146', 's-200'])).toHaveLength(3);
  });

  it('answers nothing for an option no product holds, nor for the old stored text', async () => {
    expect(await skusFor(['s-999'])).toEqual([]);
    expect(await skusFor(['["s-146"]'])).toEqual([]);
  });
});
