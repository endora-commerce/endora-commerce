import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T048 — Flipping `isFilterable` on a ProductAttribute from false to true via
 * `PATCH /admin/catalog/attributes/:key` must cause the attribute to appear in
 * `GET /catalog/filters` within the same test run — no redeploy, no manual
 * reindex step visible to the operator. Proves FR-004 / SC-006.
 */

interface FilterDef {
  attributeKey: string;
}

describe('PATCH /admin/catalog/attributes/:key — hot swap of isFilterable', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('attribute appears in GET /catalog/filters after flipping isFilterable=true', async () => {
    // Precondition: seed data has `internal_sku_notes` with isFilterable=false.
    const before = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as { data: FilterDef[] };
    expect(beforeBody.data.map((f) => f.attributeKey)).not.toContain('internal_sku_notes');

    // Feature 012 / FR-029 — filters with no values across the visible
    // products are omitted. Seed at least one product value so the
    // attribute can show up after the flip.
    const products = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const firstProductId = (
      (products.json() as { data: Array<{ id: string }> }).data[0]
    )?.id;
    if (firstProductId) {
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/products/${firstProductId}`,
        payload: { attributeValues: { internal_sku_notes: 'hotswap-fixture' } },
        cookies: { b2b_session: 'stub-admin-session' },
      });
    }

    // Flip isFilterable=true.
    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/internal_sku_notes',
      payload: { isFilterable: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patch.statusCode).toBe(200);

    // Must appear in the next filters call — no separate reindex command run by hand.
    const after = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as { data: FilterDef[] };
    expect(afterBody.data.map((f) => f.attributeKey)).toContain('internal_sku_notes');
  });
});
