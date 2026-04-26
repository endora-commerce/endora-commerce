import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T089–T091 — admin read endpoints feeding the Products list, Categories
 * tree, and Attributes manager. Plus a categories CRUD smoke test (T090):
 * create → reparent → cycle guard → soft-delete with children rejected.
 */

describe('Admin catalog list endpoints', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists products for the admin (more permissive than the public list)', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; sku: string; status: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]).toHaveProperty('attributeValues');
  });

  it('lists attributes for the admin', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attributes',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ key: string; isSearchable: boolean }> };
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('lists categories for the admin', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/categories',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('CRUDs a category with parent reparenting + cycle guard', async () => {
    // Create root.
    const rootRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { name: { 'en-US': 'Test Root' }, slug: 'admin-test-root' },
    });
    expect(rootRes.statusCode).toBe(201);
    const root = (rootRes.json() as { data: { id: string } }).data;

    // Create child under root.
    const childRes = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        name: { 'en-US': 'Test Child' },
        slug: 'admin-test-child',
        parentCategoryId: root.id,
      },
    });
    expect(childRes.statusCode).toBe(201);
    const child = (childRes.json() as { data: { id: string } }).data;

    // Cycle guard: try to make root a child of its own descendant.
    const cycleRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${root.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentCategoryId: child.id },
    });
    expect(cycleRes.statusCode).toBe(409);

    // Cannot delete root while child still attached.
    const deleteWithChildren = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/categories/${root.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(deleteWithChildren.statusCode).toBe(409);

    // Detach + delete child first, then root.
    const detach = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${child.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { parentCategoryId: null },
    });
    expect(detach.statusCode).toBe(200);

    const deleteChild = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/categories/${child.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(deleteChild.statusCode).toBe(204);

    const deleteRoot = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/categories/${root.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(deleteRoot.statusCode).toBe(204);
  });
});
