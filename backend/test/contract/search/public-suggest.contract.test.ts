import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, SearchSuggestResponseSchema } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchIndexer } from '../../../src/modules/search/services/search-indexer.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { ProductAttribute } from '../../../src/modules/catalog/entities/product-attribute.entity.js';

/**
 * T010 — Contract test for `GET /api/v1/search/suggest` (US1, feature 006).
 *
 * Test surface:
 *   - happy path → 200 with `{ data, meta }`, capped by `limit`.
 *   - phrase below threshold → 400 QUERY_TOO_SHORT.
 *   - phrase over 512 chars → 400 QUERY_TOO_LONG.
 *   - `limit` over 50 → 400 LIMIT_OUT_OF_RANGE.
 *   - missing `q` → 400 QUERY_TOO_SHORT.
 *
 * Meilisearch is required for the happy-path assertion. CI provides it
 * via `getmeili/meilisearch:v1.11`; locally the docker-compose stack
 * exposes it at MEILISEARCH_URL.
 */

const meilisearchHost = process.env['MEILISEARCH_URL'] ?? 'http://localhost:7700';
const meilisearchKey = process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';

describe('GET /api/v1/search/suggest — feature 006 / US1', () => {
  let h: BackendServerHandle;
  let originalMeiliUrl: string | undefined;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    originalMeiliUrl = process.env['MEILISEARCH_URL'];
    originalMeiliKey = process.env['MEILISEARCH_API_KEY'];
    process.env['MEILISEARCH_URL'] = meilisearchHost;
    process.env['MEILISEARCH_API_KEY'] = meilisearchKey;

    h = await setupBackendServer();

    // The seeded catalog has at least one ProductAttribute; flag one as
    // searchable so the indexer surfaces attribute values too. The MVP
    // happy-path assertion only requires name matching, so this is
    // belt-and-braces.
    const em = h.em();
    const attrs = await em.find(ProductAttribute, {});
    if (attrs.length > 0) {
      attrs[0]!.isSearchable = true;
      await em.flush();
    }

    // Index every channel so any seeded sales channel can answer queries.
    const indexer = new SearchIndexer({
      meilisearchHost,
      meilisearchApiKey: meilisearchKey,
    });
    const channels = await h.em().find(SalesChannel, {});
    for (const channel of channels) {
      await indexer.reindexChannel(h.em(), channel);
    }
    // Meilisearch's task queue is async; give it a beat so the freshly
    // indexed corpus is observable to the next query.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }, 60_000);

  afterAll(async () => {
    if (originalMeiliUrl === undefined) delete process.env['MEILISEARCH_URL'];
    else process.env['MEILISEARCH_URL'] = originalMeiliUrl;
    if (originalMeiliKey === undefined) delete process.env['MEILISEARCH_API_KEY'];
    else process.env['MEILISEARCH_API_KEY'] = originalMeiliKey;
    await teardownBackendServer(h);
  });

  it('returns 200 with { data, meta } for a valid query', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=pro',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; name: string }>;
      meta: { limit: number; minimumQueryLength: number; queryEcho: string };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.minimumQueryLength).toBe(3);
    expect(body.meta.queryEcho).toBe('pro');
    expect(body.meta.limit).toBeGreaterThan(0);
    expect(body.data.length).toBeLessThanOrEqual(body.meta.limit);
  });

  it('enriches each suggestion with SKU, image, and the resolved price/visibility', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=pro',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(res.statusCode).toBe(200);
    // The whole envelope must satisfy the enriched contract schema.
    const parsed = SearchSuggestResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    // The happy-path corpus answers `pro` with at least one hit; assert the
    // enriched surface the storefront popup renders (SKU + per-customer price
    // resolution). `primaryAssetUrl` is null-or-URL by contract.
    expect(parsed.data.data.length).toBeGreaterThan(0);
    for (const item of parsed.data.data) {
      expect(typeof item.sku).toBe('string');
      expect(item.sku.length).toBeGreaterThan(0);
      // The pricing enricher is wired in the test server, so every hit carries
      // a resolved visibility mode.
      expect(['gross_only', 'net_only', 'both', 'none']).toContain(
        item.priceDisplayMode,
      );
      if (item.basePrice) {
        expect(typeof item.basePrice.amount).toBe('string');
        expect(typeof item.basePrice.currency).toBe('string');
      }
    }
  });

  it('honours an explicit limit override', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=pro&limit=2',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: unknown[];
      meta: { limit: number };
    };
    expect(body.meta.limit).toBe(2);
    expect(body.data.length).toBeLessThanOrEqual(2);
  });

  it('returns 400 QUERY_TOO_SHORT when the phrase is below the minimum length', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=pr',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.QUERY_TOO_SHORT,
    );
  });

  it('returns 400 QUERY_TOO_SHORT when q is missing entirely', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.QUERY_TOO_SHORT,
    );
  });

  it('returns 400 QUERY_TOO_LONG when the phrase exceeds 512 characters', async () => {
    const tooLong = 'a'.repeat(513);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/search/suggest?q=${tooLong}`,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.QUERY_TOO_LONG,
    );
  });

  it('returns 400 LIMIT_OUT_OF_RANGE when limit > 50', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=pro&limit=200',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.LIMIT_OUT_OF_RANGE,
    );
  });

  it('returns 400 LIMIT_OUT_OF_RANGE when limit is zero', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/search/suggest?q=pro&limit=0',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.LIMIT_OUT_OF_RANGE,
    );
  });
});
