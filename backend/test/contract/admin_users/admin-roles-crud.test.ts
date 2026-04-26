import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, PERMISSION_CATALOGUE } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * T193 — Admin role CRUD + permissions catalogue exposure. Validates the
 * role-in-use guard (can't delete a role that still has assignees) and the
 * unknown-permission guard.
 */

describe('Admin roles CRUD', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('exposes the canonical permissions catalogue', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/permissions',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ code: string; module: string }> };
    expect(body.data.length).toBe(PERMISSION_CATALOGUE.length);
    expect(body.data.some((p) => p.code === 'orders:read')).toBe(true);
  });

  it('upserts a role by code, then deletes it once unassigned', async () => {
    const upsert = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/order_manager',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'order_manager',
        name: 'Order manager',
        permissions: ['orders:read', 'orders:write'],
      },
    });
    expect(upsert.statusCode).toBe(200);
    const role = (upsert.json() as { data: { id: string; permissions: string[] } }).data;
    expect(role.permissions).toEqual(['orders:read', 'orders:write']);

    const update = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/order_manager',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'order_manager',
        name: 'Order manager (updated)',
        permissions: ['orders:read'],
      },
    });
    expect(update.statusCode).toBe(200);
    expect((update.json() as { data: { permissions: string[] } }).data.permissions).toEqual([
      'orders:read',
    ]);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${role.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(del.statusCode).toBe(204);
  });

  it('rejects an unknown permission with VALIDATION_FAILED', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/bad_role',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        code: 'bad_role',
        name: 'Bad role',
        permissions: ['nonexistent:permission'],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('refuses to delete a role with assignees (ADMIN_ROLE_IN_USE)', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${READ_ONLY_ROLE_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ADMIN_ROLE_IN_USE);
  });
});
