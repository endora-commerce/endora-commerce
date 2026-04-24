import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T055 — Integration proof of FR-004 / SC-006 "hot swap":
 *   1. Admin toggles an attribute to isSearchable=true.
 *   2. The storefront search filter panel reflects the change in the SAME process —
 *      no external trigger, no deploy.
 *
 * This is the integration counterpart to the contract test T048 (hot-swap of
 * isFilterable via `/catalog/filters`). Here we exercise the indexer pipeline
 * (T067): attribute.updated.v1 → search-indexer → fresh results.
 */

interface FilterDef {
  attributeKey: string;
}
interface ProductSummary {
  id: string;
  slug: string;
}

describe('attribute hot swap reflects in search filters and results', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('toggle isFilterable=true then GET /catalog/filters shows the attribute', async () => {
    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/certification',
      payload: { isFilterable: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patch.statusCode).toBe(200);

    const filters = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/filters',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(filters.statusCode).toBe(200);
    const body = filters.json() as { data: FilterDef[] };
    expect(body.data.map((f) => f.attributeKey)).toContain('certification');
  });

  it('toggle isSearchable=true then GET /catalog/products?q=<value> finds products by that attribute', async () => {
    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/certification',
      payload: { isSearchable: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patch.statusCode).toBe(200);

    const search = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=ISO9001',
      headers: { 'x-sales-channel': 'pl_retail' },
    });
    expect(search.statusCode).toBe(200);
    const body = search.json() as { data: ProductSummary[] };
    expect(body.data.length).toBeGreaterThan(0);
  });
});
