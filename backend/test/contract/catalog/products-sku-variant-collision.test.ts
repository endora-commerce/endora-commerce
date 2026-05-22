import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 025 — PATCH product SKU must respect the global SKU namespace
 * shared with product_variants (research R3).
 */
describe('Admin Products contract — feature 025 SKU vs variant collision', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createSimpleProduct(sku: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'simple',
        name: { 'en-US': sku },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('PATCH refuses a SKU already held by a variant (400 sku_in_use)', async () => {
    const parentRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'VAR-COLLIDE-PARENT',
        type: 'configurable',
        name: { 'en-US': 'Parent' },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(parentRes.statusCode).toBe(201);
    const parentId = (parentRes.json() as { data: { id: string } }).data.id;

    const variantRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parentId}/variants`,
      payload: {
        sku: 'VAR-COLLIDE-001',
        variantAttributeValues: { color: 'red' },
      },
      cookies: adminCookie,
    });
    expect(variantRes.statusCode).toBe(201);

    const victimId = await createSimpleProduct('VAR-COLLIDE-VICTIM');
    const patchRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${victimId}`,
      payload: { sku: 'VAR-COLLIDE-001' },
      cookies: adminCookie,
    });
    expect(patchRes.statusCode).toBe(400);
    const body = patchRes.json() as { error: { message: string } };
    expect(body.error.message).toMatch(/sku_in_use/);
  });
});
