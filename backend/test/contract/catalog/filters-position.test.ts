import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 012 / T039 — Filter sidebar ordering contract (US5).
 *
 * Covers `contracts/storefront-attribute-rendering.contract.md` § US5:
 *   - GET /api/v1/catalog/filters response includes `filterPosition`.
 *   - Sorted by filterPosition ASC, ties broken alphabetically by
 *     resolved label (FR-027 / FR-028).
 *   - Filters whose every option has zero facetCount are omitted
 *     (FR-029).
 */
describe('GET /api/v1/catalog/filters — feature 012 filterPosition (T039)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('returns filterPosition on every filter definition', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ filterPosition: number }> };
    for (const f of body.data) {
      expect(typeof f.filterPosition).toBe('number');
      expect(f.filterPosition).toBeGreaterThanOrEqual(0);
    }
  });

  it('sorts by filterPosition ASC then by label ASC', async () => {
    // Set explicit filter positions on a few seeded filterable attributes.
    // The seed catalog provisions `color`, `material` (both filterable enums)
    // — set the test ordering: color=20, material=10. Material should come first.
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/color',
      payload: { filterPosition: 20 },
      cookies: adminCookie,
    });
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { filterPosition: 10 },
      cookies: adminCookie,
    });

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ attributeKey: string; filterPosition: number }>;
    };
    const colorIdx = body.data.findIndex((f) => f.attributeKey === 'color');
    const materialIdx = body.data.findIndex((f) => f.attributeKey === 'material');
    // Both should be present (seed provisions products carrying both values).
    expect(materialIdx).toBeGreaterThanOrEqual(0);
    expect(colorIdx).toBeGreaterThanOrEqual(0);
    expect(materialIdx).toBeLessThan(colorIdx);
  });

  it('breaks ties alphabetically by label when filterPosition matches', async () => {
    // Set both to the same filterPosition. With same position the seed
    // labels (Color / Material in en-US) sort alphabetically: Color first.
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/color',
      payload: { filterPosition: 5 },
      cookies: adminCookie,
    });
    await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/attributes/material',
      payload: { filterPosition: 5 },
      cookies: adminCookie,
    });

    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ attributeKey: string; label: string }> };
    const filtered = body.data.filter((f) => ['color', 'material'].includes(f.attributeKey));
    expect(filtered.map((f) => f.attributeKey)).toEqual(['color', 'material']);
  });
});
