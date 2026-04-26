import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  PLATFORM_ADMIN_ROLE_ID,
  READ_ONLY_ROLE_ID,
} from '../../helpers/seed-admins.js';

/**
 * T193 — Admin user CRUD over the new `/api/v1/admin/admin-users` surface.
 * Gated by `admin_users:manage`; the read-only seeded admin is rejected.
 */

describe('Admin users CRUD', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists, creates, updates, and soft-deletes an admin user', async () => {
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(list.statusCode).toBe(200);
    const initialCount = (list.json() as { data: unknown[] }).data.length;

    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: 'created-admin@example.com',
        password: 'super-strong-pass-123!',
        firstName: 'New',
        lastName: 'Admin',
        adminRoleId: READ_ONLY_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    const created = (create.json() as { data: { id: string; adminRoleId: string } }).data;
    expect(created.adminRoleId).toBe(READ_ONLY_ROLE_ID);

    const update = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { adminRoleId: PLATFORM_ADMIN_ROLE_ID, status: 'inactive' },
    });
    expect(update.statusCode).toBe(200);
    const updated = (update.json() as { data: { adminRoleId: string; status: string } }).data;
    expect(updated.adminRoleId).toBe(PLATFORM_ADMIN_ROLE_ID);
    expect(updated.status).toBe('inactive');

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect((after.json() as { data: unknown[] }).data.length).toBe(initialCount + 1);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-users/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);

    const finalList = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect((finalList.json() as { data: unknown[] }).data.length).toBe(initialCount);
  });

  it('rejects duplicate email with EMAIL_ALREADY_REGISTERED', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: 'platform-admin@example.com',
        password: 'super-strong-pass-123!',
        firstName: 'Dup',
        lastName: 'Email',
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.EMAIL_ALREADY_REGISTERED);
  });
});
