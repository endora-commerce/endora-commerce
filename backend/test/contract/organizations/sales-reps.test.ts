import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * T073 — Sales-rep ↔ organization assignment endpoints.
 */
describe('Sales-rep assignment routes (US7)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists no assignments on a fresh organization', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('assigns a sales rep then lists it', async () => {
    const post = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    expect(post.statusCode).toBe(201);
    const created = (post.json() as { data: { adminUserId: string; organizationId: string } }).data;
    expect(created.adminUserId).toBe(TEST_ADMIN_ID);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const body = list.json() as { data: Array<{ adminUserId: string }> };
    expect(body.data.find((r) => r.adminUserId === TEST_ADMIN_ID)).toBeTruthy();
  });

  it('reverse-lists organizations a sales rep is assigned to', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string }> };
    expect(body.data.find((o) => o.organizationId === TEST_ORGANIZATION_ID)).toBeTruthy();
  });

  it('unassigns and 404s on subsequent unassign', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);
    const del2 = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del2.statusCode).toBe(404);
  });

  it('returns 404 when assigning a non-existent admin user', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminUserId: '00000000-0000-4000-8000-00000000ffff' },
    });
    expect(res.statusCode).toBe(404);
  });
});
