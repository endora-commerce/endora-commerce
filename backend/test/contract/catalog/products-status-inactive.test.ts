import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Feature 032 — product status inactive', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(sku: string): Promise<string> {
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

  it('PATCH { status: "inactive" } sets archivedAt and returns inactive', async () => {
    const id = await createProduct('INACTIVE-001');
    const before = Date.now();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'inactive' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; archivedAt: string | null };
    };
    expect(body.data.status).toBe('inactive');
    expect(body.data.archivedAt).not.toBeNull();
    expect(new Date(body.data.archivedAt!).getTime()).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(body)).not.toContain('"archived"');
  });

  it('write alias archived → persists and returns inactive', async () => {
    const id = await createProduct('INACTIVE-ALIAS-001');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'archived' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { status: string } };
    expect(body.data.status).toBe('inactive');
  });

  it('list counts expose inactive tab and status=inactive filter', async () => {
    const id = await createProduct('INACTIVE-LIST-001');
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'inactive' },
      cookies: adminCookie,
    });

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products?includeArchived=1&status=inactive',
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ id: string; status: string }>;
      counts: { inactive: number };
    };
    expect(body.counts.inactive).toBeGreaterThanOrEqual(1);
    expect(body.data.some((p) => p.id === id && p.status === 'inactive')).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/"status"\s*:\s*"archived"/);
  });
});
