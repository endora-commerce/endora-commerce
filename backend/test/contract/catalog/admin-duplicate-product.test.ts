import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `POST /admin/catalog/products/:id/duplicate` returns a fresh draft product
 * with a derived SKU/slug and a "(copy)"-tagged name. The source row is left
 * untouched. The new row's `lowStockThreshold` is copied over.
 */
describe('POST /api/v1/admin/catalog/products/:id/duplicate', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a draft copy with a derived SKU and copies inventory flags', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'DUP-SRC-001',
        type: 'simple' as const,
        name: { 'en-US': 'Dup source' },
        description: { 'en-US': 'Source for duplicate' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public' as const,
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode).toBe(201);
    const srcBody = created.json() as { data: { id: string; sku: string } };
    const sourceId = srcBody.data.id;

    // PATCH the inventory threshold (createProduct does not persist it).
    const patchRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${sourceId}`,
      payload: { lowStockThreshold: 5 },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(patchRes.statusCode).toBe(200);

    const dupRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${sourceId}/duplicate`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(dupRes.statusCode).toBe(201);
    const dupBody = dupRes.json() as {
      data: {
        id: string;
        sku: string;
        slug: string;
        status: string;
        name: Record<string, string>;
        lowStockThreshold: number | null;
      };
    };
    expect(dupBody.data.id).not.toBe(sourceId);
    expect(dupBody.data.sku.startsWith('DUP-SRC-001-copy')).toBe(true);
    expect(dupBody.data.slug.includes('copy')).toBe(true);
    expect(dupBody.data.status).toBe('draft');
    expect(dupBody.data.name['en-US']).toContain('(copy)');
    expect(dupBody.data.lowStockThreshold).toBe(5);

    // Duplicating the duplicate must allocate a non-colliding SKU.
    const dupAgain = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${sourceId}/duplicate`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(dupAgain.statusCode).toBe(201);
    const dupAgainBody = dupAgain.json() as { data: { sku: string } };
    expect(dupAgainBody.data.sku).not.toBe(dupBody.data.sku);
  });

  it('returns 404 when the source product is missing', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/00000000-0000-0000-0000-000000000099/duplicate',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
  });
});
