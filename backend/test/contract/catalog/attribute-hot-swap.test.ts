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
    const before = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters' });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as { data: FilterDef[] };
    expect(beforeBody.data.map((f) => f.attributeKey)).not.toContain('internal_sku_notes');

    // Flip isFilterable=true.
    const patch = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/internal_sku_notes',
      payload: { isFilterable: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patch.statusCode).toBe(200);

    // Must appear in the next filters call — no separate reindex command run by hand.
    const after = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters' });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as { data: FilterDef[] };
    expect(afterBody.data.map((f) => f.attributeKey)).toContain('internal_sku_notes');
  });
});
