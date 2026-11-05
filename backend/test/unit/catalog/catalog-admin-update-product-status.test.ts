import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T002 — the `status` field on `updateProduct`.
 *
 * Feature 163, spec Session 2026-10-25 (T156c; FR-010, FR-019, O-5) — a status write
 * never sets or clears `archivedAt`: `inactive` is plain off, `active` never restores,
 * and archiving is the separate Archive / Restore action. This file used to assert the
 * feature 022 / 032 cross-field rule (`inactive` archives, leaving it un-archives),
 * which that session removed.
 *
 * Tests run through the HTTP layer, the simplest fixture being the existing PATCH
 * route.
 */
describe('updateProduct.status never touches archivedAt (spec 163)', () => {
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

  async function patch(id: string, payload: Record<string, unknown>) {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { status: string; archivedAt: string | null; visibility: string } }).data;
  }

  it('PATCH { status: "inactive" } on an active product leaves archivedAt null', async () => {
    const id = await createProduct('STATUS-INACT-001');
    await patch(id, { status: 'active' });
    const data = await patch(id, { status: 'inactive' });
    expect(data.status).toBe('inactive');
    expect(data.archivedAt).toBeNull();
  });

  it('PATCH { status: "active" } on an archived product leaves it archived', async () => {
    const id = await createProduct('STATUS-REACT-001');
    const archive = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${id}/archive`,
      cookies: adminCookie,
    });
    expect(archive.statusCode).toBe(200);
    const archivedAt = (archive.json() as { data: { archivedAt: string | null } }).data.archivedAt;
    expect(archivedAt).not.toBeNull();

    const data = await patch(id, { status: 'active' });
    expect(data.status).toBe('active');
    expect(data.archivedAt).toBe(archivedAt);

    const off = await patch(id, { status: 'inactive' });
    expect(off.archivedAt).toBe(archivedAt);
  });

  it('PATCH without status leaves status and archivedAt unchanged', async () => {
    const id = await createProduct('STATUS-NOOP-001');
    const data = await patch(id, { visibility: 'logged_in_only' });
    expect(data.status).toBe('inactive'); // creation default (Q1-d)
    expect(data.archivedAt).toBeNull();
    expect(data.visibility).toBe('logged_in_only');
  });
});
