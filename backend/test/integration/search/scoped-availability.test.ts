import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meilisearch } from 'meilisearch';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchIndexer, indexUidFor } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import {
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import {
  clearProductScopes,
  setChannelStatus,
  setGlobalWindow,
} from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 7 (T048, R8) — the Meilisearch path of the listing.
 *
 *  - a channel document carries `liveLanguages`, `publishFromMs`,
 *    `publishUntilMs` and the channel-effective audience;
 *  - the **index filter** excludes a product off at (C, L), outside its window
 *    at query time, or outside the effective audience — so a page is full, not
 *    short (issue #151);
 *  - a document indexed before the deploy (none of the fields) is served as
 *    before.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — scoped availability on the Meilisearch path [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channel: SalesChannel;
  const on: MinimumProductFixture[] = [];
  let off: MinimumProductFixture;
  let ended: MinimumProductFixture;
  let restricted: MinimumProductFixture;
  let legacy: MinimumProductFixture;
  const saved: Record<string, string | undefined> = {};
  const client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });

  beforeAll(async () => {
    for (const key of ['CATALOG_SEARCH_BACKEND', 'MEILISEARCH_URL', 'MEILISEARCH_API_KEY']) saved[key] = process.env[key];
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    const em = h.em();
    channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const create = (label: string) =>
      createMinimumProduct(em, {
        sku: `S163SRCH-${label}-${RUN}`,
        nameEn: `Search ${label} ${RUN}`,
        namePl: `Szukaj ${label} ${RUN}`,
        channelIds: [channel.id],
      });
    // The off products sort first by SKU; with `limit=2` a filter applied only
    // after the cut would answer a short page.
    off = await create('A-OFF');
    ended = await create('B-ENDED');
    restricted = await create('C-RESTRICTED');
    on.push(await create('D-ON'), await create('E-ON'));
    legacy = await create('F-LEGACY');
    await setChannelStatus(em, off.id, [channel.id], 'inactive');
    // A window that has already ended. The indexer keys a document on the
    // live languages, never on the window, so the document is written with its
    // `publishUntilMs` in the past: only the query-time filter can drop it.
    await setGlobalWindow(em, ended.id, { from: null, until: new Date(Date.now() - 1000) });
    await em
      .getConnection()
      .execute(
        `insert into product_channel_scopes (product_id, sales_channel_id, visibility, allowed_organization_ids, created_at, updated_at)
         values (?, ?, 'organization_restricted', '[]'::jsonb, now(), now())`,
        [restricted.id, channel.id],
      );

    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    await indexer.reindexChannel(em, channel);
    // A document as the indexer wrote it before the deploy — none of the fields.
    const index = client.index(indexUidFor(channel));
    const task = await index.addDocuments(
      [{ id: legacy.id, sku: legacy.sku, name: legacy.nameEn, slug: legacy.sku.toLowerCase(), type: 'simple', status: 'active', visibility: 'public', categoryIds: [], categorySlugs: [], attributes: {}, searchableOptions: [], createdAt: 0, updatedAt: 0, description: '', primaryAssetUrl: null }],
      { primaryKey: 'id' },
    );
    await client.tasks.waitForTask(task.taskUid);
  }, 120_000);

  afterAll(async () => {
    if (h) {
      await clearProductScopes(h.em(), [off.id, ended.id, restricted.id, ...on.map((p) => p.id), legacy.id]);
      await teardownBackendServer(h);
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('indexes the availability fields and leaves the switched-off product out', async () => {
    const index = client.index(indexUidFor(channel));
    const doc = (await index.getDocument(on[0]!.id)) as Record<string, unknown>;
    expect(doc['liveLanguages']).toEqual(expect.arrayContaining([channel.defaultLanguage]));
    expect(doc['publishFromMs']).toBe(0);
    expect(doc['publishUntilMs']).toBe(Number.MAX_SAFE_INTEGER);
    expect(doc['allowedOrganizationIds']).toEqual([]);
    // Feature 174 — the effective texts per channel language, searched as `texts.<L>.*`.
    expect((doc['texts'] as Record<string, { name: string }>)[channel.defaultLanguage]?.name).toBe(on[0]!.nameEn);
    const restrictedDoc = (await index.getDocument(restricted.id)) as Record<string, unknown>;
    expect(restrictedDoc['visibility']).toBe('organization_restricted');
    await expect(index.getDocument(off.id)).rejects.toThrow();
  });

  it('filters window and audience in the index, so a page is full', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163SRCH`)}&limit=2&sort=name`,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
    // The ended product is in the index; the filter the page was cut from left it out.
    const endedDoc = (await client.index(indexUidFor(channel)).getDocument(ended.id)) as Record<string, unknown>;
    expect(endedDoc['publishUntilMs']).toBeLessThan(Date.now());
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(off.id);
    expect(ids).not.toContain(ended.id);
    expect(ids).not.toContain(restricted.id);
  });

  it('serves a pre-deploy document without the fields as before', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(legacy.sku)}&limit=10`,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id)).toContain(legacy.id);
  });
});
