import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 032 — the product status `inactive`. Since spec 163's Session 2026-10-25
 * (FR-010, FR-112) it is plain off: it no longer archives, and the `archived` write
 * alias is refused (archiving is `POST …/products/:id/archive`).
 */
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
        name: sku,
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  it('PATCH { status: "inactive" } returns inactive and does not archive (spec 163, FR-010)', async () => {
    const id = await createProduct('INACTIVE-001');
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
    expect(body.data.archivedAt).toBeNull();
    expect(JSON.stringify(body)).not.toContain('"archived"');
  });

  it('the legacy write alias archived is refused, not mapped (spec 163, FR-112, O-1)', async () => {
    const id = await createProduct('INACTIVE-ALIAS-001');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'archived' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('list counts expose inactive tab and status=inactive filter', async () => {
    const id = await createProduct('INACTIVE-LIST-001');
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'inactive' },
      cookies: adminCookie,
    });

    // A non-archived inactive product is listed under `status=inactive` without
    // asking for archived rows (spec 163, FR-113).
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products?status=inactive&pageSize=500',
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
