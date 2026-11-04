import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meilisearch } from 'meilisearch';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SearchIndexer, indexUidFor } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearProductScopes, clearValueOverrides, setLanguageStatus } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T059; FR-033, US3,
 * `contracts/search-index.md`) — storefront search matches the shopper's language only.
 *
 * A product's Global name is English ("Drillx…"); `pl_retail` × pl-PL translates it
 * ("Wiertarkax…"); `pl_b2b_vip` has no translation. A Polish shopper of `pl_retail` does not
 * find it by the English word and does find it by the Polish one; a Polish shopper of
 * `pl_b2b_vip` finds it by the Global word (C×L vs Global per channel). A product switched off
 * at (`pl_b2b_vip`, pl-PL) is absent there. One word per name, so Meilisearch's matching
 * strategy cannot answer a query by dropping its distinguishing term.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';
type Code = 'pl_retail' | 'pl_b2b_vip';

describe('172 — search matches the shopper language only [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const GLOBAL = `Drillx${RUN}`;
  const RETAIL_PL = `Wiertarkax${RUN}`;
  let drill: MinimumProductFixture;
  let off: MinimumProductFixture;
  let retail: SalesChannel;
  let vip: SalesChannel;
  const saved: Record<string, string | undefined> = {};
  const client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });

  async function hits(code: Code, q: string): Promise<Array<{ id: string; name: string }>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(q)}&limit=20`,
      headers: { 'x-sales-channel': code, 'accept-language': 'pl-PL' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    return (res.json() as { data: Array<{ id: string; name: string }> }).data;
  }

  beforeAll(async () => {
    for (const key of ['CATALOG_SEARCH_BACKEND', 'MEILISEARCH_URL', 'MEILISEARCH_API_KEY']) saved[key] = process.env[key];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    const em = h.em();
    retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    vip = await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' });
    drill = await createMinimumProduct(em, { sku: `S170LM-D-${RUN}`, nameEn: GLOBAL, namePl: GLOBAL, channelIds: [retail.id, vip.id] });
    off = await createMinimumProduct(em, {
      sku: `S170LM-O-${RUN}`,
      nameEn: `Offx${RUN}`,
      namePl: `Offx${RUN}`,
      channelIds: [retail.id, vip.id],
    });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel_language', channelId: retail.id, languageCode: 'pl-PL' }, value: RETAIL_PL },
    ]);
    await setLanguageStatus(em, off.id, vip.id, vip.defaultLanguage, 'inactive');
    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    await indexer.reindexChannel(em, retail);
    await indexer.reindexChannel(em, vip);
  }, 120_000);

  afterAll(async () => {
    if (h) {
      await clearValueOverrides(h.em(), [drill.id]);
      await clearProductScopes(h.em(), [drill.id, off.id]);
      await teardownBackendServer(h);
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('indexes the effective texts of every channel language', async () => {
    const doc = (await client.index(indexUidFor(retail)).getDocument(drill.id)) as Record<string, unknown>;
    const texts = doc['texts'] as Record<string, { name: string }>;
    expect(texts[retail.defaultLanguage]?.name).toBe(RETAIL_PL);
    expect(doc['name']).toBeUndefined();
  });

  it('a Polish shopper does not find the product by its English (Global) name', async () => {
    expect((await hits('pl_retail', GLOBAL)).map((p) => p.id)).not.toContain(drill.id);
  });

  it('a Polish shopper finds it by the Polish name, and the card shows that name', async () => {
    const found = (await hits('pl_retail', RETAIL_PL)).find((p) => p.id === drill.id);
    expect(found?.name).toBe(RETAIL_PL);
  });

  it('on a channel without the translation the Global name is the Polish text (C×L vs Global)', async () => {
    expect((await hits('pl_b2b_vip', GLOBAL)).map((p) => p.id)).toContain(drill.id);
    expect((await hits('pl_b2b_vip', RETAIL_PL)).map((p) => p.id)).not.toContain(drill.id);
  });

  it('a product off at (C, L) is absent there and present where it is on', async () => {
    expect((await hits('pl_b2b_vip', `Offx${RUN}`)).map((p) => p.id)).not.toContain(off.id);
    expect((await hits('pl_retail', `Offx${RUN}`)).map((p) => p.id)).toContain(off.id);
  });
});
