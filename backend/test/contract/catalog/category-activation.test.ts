import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T020 (feature 068) — contract for the category activation switch.
 *
 * `categories.is_active` is the catalog-owned visibility flag introduced by
 * data-model.md §11: an inactive category stays in the admin tree (so it can
 * be re-enabled) but disappears from every customer-facing read. This test
 * pins the admin write surface:
 *
 *   - the admin list exposes `isActive` on every node;
 *   - `POST /api/v1/admin/catalog/categories` accepts it and defaults to true;
 *   - `PATCH /api/v1/admin/catalog/categories/:id` accepts it and returns it;
 *   - the write stays gated by `catalog:write`.
 */

interface AdminCategoryShape {
  id: string;
  slug: string;
  isActive: boolean;
}

const ADMIN = { b2b_session: 'stub-admin-session' };
// Feature 026 fixture — an admin holding only `orders:read`.
const RESTRICTED = { b2b_session: 'stub-restricted-admin-session' };

describe('category activation — admin contract (T020)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function listCategories(): Promise<AdminCategoryShape[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: AdminCategoryShape[] }).data;
  }

  it('exposes isActive on every node of the admin list', async () => {
    const rows = await listCategories();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.isActive).toBe('boolean');
    }
    // The seeded tree predates the flag: DEFAULT true keeps it visible.
    expect(rows.every((r) => r.isActive)).toBe(true);
  });

  it('POST accepts isActive and defaults it to true', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
      payload: {
        name: { 'en-US': 'Hidden branch' },
        slug: 'hidden-branch',
        isActive: false,
      },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as { data: AdminCategoryShape }).data.isActive).toBe(false);

    const defaulted = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      cookies: ADMIN,
      payload: {
        name: { 'en-US': 'Visible branch' },
        slug: 'visible-branch',
      },
    });
    expect(defaulted.statusCode).toBe(201);
    expect((defaulted.json() as { data: AdminCategoryShape }).data.isActive).toBe(true);
  });

  it('PATCH accepts and returns isActive, and the change is durable', async () => {
    const target = (await listCategories()).find((c) => c.slug === 'small-widgets');
    expect(target).toBeDefined();

    const off = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${target!.id}`,
      cookies: ADMIN,
      payload: { isActive: false },
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { data: AdminCategoryShape }).data.isActive).toBe(false);

    const afterOff = await listCategories();
    expect(afterOff.find((c) => c.id === target!.id)?.isActive).toBe(false);

    const on = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${target!.id}`,
      cookies: ADMIN,
      payload: { isActive: true },
    });
    expect(on.statusCode).toBe(200);
    expect((on.json() as { data: AdminCategoryShape }).data.isActive).toBe(true);
  });

  it('keeps the activation write gated by catalog:write', async () => {
    const target = (await listCategories()).find((c) => c.slug === 'widgets');
    expect(target).toBeDefined();

    const anonymous = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${target!.id}`,
      payload: { isActive: false },
    });
    expect(anonymous.statusCode).toBe(401);

    const restricted = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/categories/${target!.id}`,
      cookies: RESTRICTED,
      payload: { isActive: false },
    });
    expect(restricted.statusCode).toBe(403);

    const unchanged = await listCategories();
    expect(unchanged.find((c) => c.id === target!.id)?.isActive).toBe(true);
  });
});
