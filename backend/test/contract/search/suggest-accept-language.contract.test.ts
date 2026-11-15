import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meilisearch } from 'meilisearch';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SearchIndexer, indexUidFor } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Issue #1011 — the typeahead (`GET /api/v1/search/suggest`, the Meilisearch path) reads its
 * language from the whole `Accept-Language` header through `requestScopeLanguage`: q-weighted,
 * each tag matched against the channel's languages (exact, then base language), else the
 * channel's default. Before, it took the header's first entry, so `en;q=0.2, pl-PL;q=0.9` was
 * searched in English.
 *
 * The run's own channel offers `en-US` (default) and `pl-PL`. The product's Global name is
 * English; its (channel, `pl-PL`) override is Polish. A card's name is the one at the request's
 * (channel, language), so the name answered says which language the request resolved to.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('Search suggest language from Accept-Language (issue #1011)', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const ENGLISH = `Drillsg${RUN}`;
  const POLISH = `Wiertarkasg${RUN}`;
  const channelId = randomUUID();
  const channelCode = `sg1011_${channelId.slice(0, 8)}`;
  let channel: SalesChannel;
  let product: MinimumProductFixture;
  const saved: Record<string, string | undefined> = {};
  const client = new Meilisearch({ host: meilisearchHost, apiKey: meilisearchKey });

  async function suggest(q: string, acceptLanguage: string): Promise<Array<{ id: string; name: string }>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/search/suggest?q=${encodeURIComponent(q)}&limit=20`,
      headers: { 'x-sales-channel': channelCode, 'accept-language': acceptLanguage },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Array<{ id: string; name: string }> }).data;
  }

  beforeAll(async () => {
    for (const key of ['MEILISEARCH_URL', 'MEILISEARCH_API_KEY']) saved[key] = process.env[key];
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;
    h = await setupBackendServer();
    const em = h.em();
    channel = em.create(SalesChannel, {
      id: channelId,
      code: channelCode,
      name: { 'en-US': `Suggest language ${RUN}` },
      defaultLanguage: 'en-US',
      languages: ['en-US', 'pl-PL'],
      defaultCurrency: 'PLN',
      currencies: ['PLN'],
      active: true,
    });
    await em.persistAndFlush(channel);
    await h.salesChannels.cache.invalidate(channelCode);
    product = await createMinimumProduct(em, {
      sku: `SG1011-${RUN}`,
      nameEn: ENGLISH,
      namePl: POLISH,
      channelIds: [channelId],
    });
    await seedScopedValues(em, product.id, [
      { field: 'name', scope: { level: 'channel_language', channelId, languageCode: 'pl-PL' }, value: POLISH },
    ]);
    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
      attributeRead: h.catalogAttributeRead,
      ...searchIndexerNeighbourPorts(h),
    });
    await indexer.reindexChannel(em, channel);
  }, 120_000);

  afterAll(async () => {
    if (h) {
      const connection = h.em().getConnection();
      if (product) {
        await clearValueOverrides(h.em(), [product.id]);
        await connection.execute(`delete from sales_channel_products where product_id = ?`, [product.id]);
      }
      await connection.execute(`delete from sales_channels where id = ?`, [channelId]);
      await client.deleteIndex(indexUidFor({ code: channelCode })).catch(() => undefined);
      await teardownBackendServer(h);
    }
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('honours the q-weights: `en;q=0.2, pl-PL;q=0.9` searches and names in Polish', async () => {
    const found = (await suggest(POLISH, 'en;q=0.2, pl-PL;q=0.9')).find((p) => p.id === product.id);
    expect(found?.name).toBe(POLISH);
  });

  it('matches a language-only tag to the channel language: `pl` is `pl-PL`', async () => {
    const found = (await suggest(POLISH, 'pl')).find((p) => p.id === product.id);
    expect(found?.name).toBe(POLISH);
  });

  it('skips an unoffered tag for the next offered one: `de-DE, pl;q=0.5` is Polish', async () => {
    const found = (await suggest(POLISH, 'de-DE, pl;q=0.5')).find((p) => p.id === product.id);
    expect(found?.name).toBe(POLISH);
  });

  it('answers a language the channel does not offer in the channel default', async () => {
    const found = (await suggest(ENGLISH, 'de-DE')).find((p) => p.id === product.id);
    expect(found?.name).toBe(ENGLISH);
  });
});
