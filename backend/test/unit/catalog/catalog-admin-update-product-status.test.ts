import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T002 — cross-field rule for the new `status` field on
 * `updateProduct`. Foundational unit test; pairs with the request-schema
 * extension in `packages/contracts/src/catalog.ts` (T004) and the service
 * branch in `catalog-admin.service.ts` (T006).
 *
 * Tests run through the HTTP layer because the cross-field semantics
 * around `archivedAt` are encoded in `CatalogAdminService.updateProduct`
 * and the simplest fixture is the existing PATCH route.
 */
describe('Feature 022 — updateProduct.status cross-field rule', () => {
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

  it('PATCH { status: "archived" } sets archivedAt to a fresh timestamp', async () => {
    const id = await createProduct('STATUS-ARCH-001');
    const before = Date.now();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'archived' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; archivedAt: string | null };
    };
    expect(body.data.status).toBe('archived');
    expect(body.data.archivedAt).not.toBeNull();
    expect(new Date(body.data.archivedAt!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('PATCH { status: "active" } on an archived product clears archivedAt', async () => {
    const id = await createProduct('STATUS-REACT-001');
    // First archive it.
    const archive = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'archived' },
      cookies: adminCookie,
    });
    expect(archive.statusCode).toBe(200);

    // Then reactivate it.
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'active' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; archivedAt: string | null };
    };
    expect(body.data.status).toBe('active');
    expect(body.data.archivedAt).toBeNull();
  });

  it('PATCH { status: "draft" } on an active product leaves archivedAt null', async () => {
    const id = await createProduct('STATUS-DRAFT-001');
    // First make it active so the transition is observable.
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'active' },
      cookies: adminCookie,
    });
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { status: 'draft' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; archivedAt: string | null };
    };
    expect(body.data.status).toBe('draft');
    expect(body.data.archivedAt).toBeNull();
  });

  it('PATCH without status leaves status and archivedAt unchanged', async () => {
    const id = await createProduct('STATUS-NOOP-001');
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { visibility: 'logged_in_only' },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { status: string; archivedAt: string | null; visibility: string };
    };
    expect(body.data.status).toBe('draft'); // creation default
    expect(body.data.archivedAt).toBeNull();
    expect(body.data.visibility).toBe('logged_in_only');
  });
});
