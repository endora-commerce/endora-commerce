import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, SearchReindexResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Contract test for `POST /api/v1/admin/search/reindex` — the manual
 * full-reindex action backing the admin "Reindex products" button (and the
 * on-demand equivalent of the periodic `search.reindex_interval_minutes`
 * sweep).
 *
 *   - admin caller → 200, response matches SearchReindexResponseSchema and
 *     reports at least the seeded public Sales Channel.
 *   - unauthenticated caller → 401 UNAUTHORIZED (the requireAdmin('search:write')
 *     pre-handler refuses before the indexer runs).
 *
 * The 200 path hits the local docker-compose Meilisearch instance, exactly
 * like the search integration suite.
 */
describe('POST /api/v1/admin/search/reindex', () => {
  let h: BackendServerHandle;
  let originalMeiliKey: string | undefined;

  beforeAll(async () => {
    // The module's SearchIndexer reads MEILISEARCH_API_KEY at construction
    // (composition time), so it must be set BEFORE setupBackendServer — the
    // local docker-compose Meilisearch requires the master key.
    originalMeiliKey = process.env['MEILISEARCH_API_KEY'];
    process.env['MEILISEARCH_API_KEY'] =
      process.env['MEILISEARCH_API_KEY'] ?? 'devMasterKeyChangeMe';
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    if (originalMeiliKey === undefined) delete process.env['MEILISEARCH_API_KEY'];
    else process.env['MEILISEARCH_API_KEY'] = originalMeiliKey;
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('rebuilds every channel index and returns a per-run summary → 200', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/reindex',
      cookies: adminCookie,
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = SearchReindexResponseSchema.parse(r.json());
    expect(body.channelsReindexed).toBeGreaterThanOrEqual(1);
    expect(body.documentCount).toBeGreaterThanOrEqual(0);
  });

  it('rejects an unauthenticated caller with 401 UNAUTHORIZED', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/reindex',
      // No admin cookie.
      payload: {},
    });
    expect(r.statusCode).toBe(401);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});

/**
 * The same route with the search engine unreachable.
 *
 * The indexer reads `MEILISEARCH_URL` when it is constructed, so this needs a
 * server of its own, composed against an address nothing listens on. The
 * operator is the one caller who can act on a search container that is down,
 * and the answer has to name that condition rather than read as a platform
 * fault: the full envelope, with the code the storefront's suggest route
 * already gives a buyer.
 */
describe('POST /api/v1/admin/search/reindex — the search backend is unreachable', () => {
  let h: BackendServerHandle;
  let originalUrl: string | undefined;

  beforeAll(async () => {
    originalUrl = process.env['MEILISEARCH_URL'];
    // Port 9 (discard) on loopback: refused immediately, never a timeout.
    process.env['MEILISEARCH_URL'] = 'http://127.0.0.1:9';
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    if (originalUrl === undefined) delete process.env['MEILISEARCH_URL'];
    else process.env['MEILISEARCH_URL'] = originalUrl;
  });

  it('answers 503 SEARCH_BACKEND_UNAVAILABLE in the typed envelope', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/search/reindex',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {},
    });
    expect(r.statusCode).toBe(503);
    const body = r.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe(ERROR_CODES.SEARCH_BACKEND_UNAVAILABLE);
    expect(body.error.message.length).toBeGreaterThan(0);
    expect(body.error.requestId).toBeTruthy();
  });
});
