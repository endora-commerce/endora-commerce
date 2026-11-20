import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SearchIndexer } from '../../../../packages/modules/search/src/backend/services/search-indexer.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { searchIndexerNeighbourPorts } from '../../helpers/search-indexer-ports.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';
import {
  ORG_A_AMOUNT,
  ORG_A_BUYER,
  ORG_B_AMOUNT,
  ORG_B_BUYER,
  RETAIL_CHANNEL,
  seedViewerPricedFixture,
  VIEWER_PRICED_SKU,
} from '../../helpers/viewer-priced-fixture.js';
import { ADMIN, makeAddress } from '../related_payers/fixtures.js';

/**
 * `specs/182-related-payers/` T056a / RP-19 (a) (FR-115, FR-120) — search hits and type-ahead on
 * a payer's commercial terms: buyer A, its cart bought for payer B on B's terms, is quoted B's
 * price by the Meilisearch-backed listing and by the suggestion popup, and the display mode stays
 * A's — B's own organization mode `none` hides nothing from A.
 *
 * Needs a reachable Meilisearch with a valid key, as every file in this directory does; it runs
 * in the nightly suite on `master` (`.github/workflows/backend-suite.yml`). Where the key is
 * refused it fails in `beforeAll` on `MeilisearchApiError`, like its neighbours, and on nothing
 * of its own.
 */
const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('search on the payer\'s terms (RP-19 a)', () => {
  let h: BackendServerHandle;
  let linkId: string;
  let orgB: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['CATALOG_SEARCH_BACKEND', 'MEILISEARCH_URL', 'MEILISEARCH_API_KEY']) saved[key] = process.env[key];
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
    for (const channel of await h.em().find(SalesChannel, {})) await indexer.reindexChannel(h.em(), channel);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const orgA = CUSTOMER_COOKIES[ORG_A_BUYER.b2b_session]!.organizationId;
    orgB = CUSTOMER_COOKIES[ORG_B_BUYER.b2b_session]!.organizationId;
    await makeAddress(h.em(), orgB, 'billing');
    const enabled = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/related_payers.enabled/value',
      cookies: ADMIN,
      payload: { scope: 'all', value: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
    const link = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgA}/related-payers`,
      cookies: ADMIN,
      payload: { payerOrganizationId: orgB, commercialTerms: 'payer' },
    });
    expect(link.statusCode, link.body).toBe(201);
    linkId = link.json().data.id;
    // B's own display mode would hide prices from B; A's is the one that applies.
    await h.em().getConnection().execute(
      `insert into price_display_mode_overrides (scope, target_id, mode, created_at, updated_at) values ('organization', ?, 'none', now(), now())
       on conflict (scope, target_id) do update set mode = excluded.mode`,
      [orgB],
    );
    const set = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/cart/buying-for',
      headers: RETAIL_CHANNEL,
      cookies: ORG_A_BUYER,
      payload: { payerOrganizationId: orgB },
    });
    expect(set.statusCode, set.body).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await h.app.inject({ method: 'PUT', url: '/api/v1/cart/buying-for', headers: RETAIL_CHANNEL, cookies: ORG_A_BUYER, payload: { payerOrganizationId: null } });
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/related-payers/links/${linkId}/revoke`, cookies: ADMIN, payload: {} });
    await h.em().getConnection().execute(`delete from price_display_mode_overrides where scope = 'organization' and target_id = ?`, [orgB]);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await teardownBackendServer(h);
  });

  it('a search hit quotes B\'s price, served by Meilisearch', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${VIEWER_PRICED_SKU}&limit=50`,
      headers: RETAIL_CHANNEL,
      cookies: ORG_A_BUYER,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['x-search-backend']).toBe('meilisearch');
    const hit = (res.json().data as Array<{ sku: string; price: { amount: number } | null }>).find((p) => p.sku === VIEWER_PRICED_SKU);
    expect(hit?.price?.amount).toBe(ORG_B_AMOUNT);
    expect(hit?.price?.amount).not.toBe(ORG_A_AMOUNT);
  }, 30_000);

  it('the type-ahead quotes B\'s price too', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/search/suggest?q=${VIEWER_PRICED_SKU}`,
      headers: RETAIL_CHANNEL,
      cookies: ORG_A_BUYER,
    });
    expect(res.statusCode, res.body).toBe(200);
    const item = (res.json().data as Array<{ sku?: string; price?: { amount: number } | null }>).find((p) => p.sku === VIEWER_PRICED_SKU);
    expect(item?.price?.amount).toBe(ORG_B_AMOUNT);
  }, 30_000);
});
