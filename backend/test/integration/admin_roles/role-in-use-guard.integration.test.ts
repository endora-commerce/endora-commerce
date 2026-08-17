import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The role-in-use guard counts **live** assignees, and only live ones.
 *
 * Feature 075, Phase C — `admin_roles` used to run
 * `em.count(AdminUser, { adminRoleId, deletedAt: null })` against a table it
 * does not own. The read goes through `adminUserReadPort` now, and the port's
 * `listByRoleId` takes no soft-delete option, so the `deletedAt` half of that
 * predicate is the part a cut can silently drop — which would leave an operator
 * unable to delete a role whose only assignee they had already removed, with a
 * 409 naming a user the admin list does not show.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('admin role deletion counts live assignees only [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a soft-deleted assignee does not keep its role alive', async () => {
    const code = `retired_role_${randomUUID().slice(0, 8)}`;
    const upsert = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      payload: { code, name: 'Retired role', permissions: ['orders:read'] },
      ...ADMIN,
    });
    expect(upsert.statusCode).toBe(200);
    const roleId = (upsert.json() as { data: { id: string } }).data.id;

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      payload: {
        email: `retired-${randomUUID().slice(0, 8)}@example.test`,
        password: 'Sufficiently-long-password-1',
        firstName: 'Retired',
        lastName: 'Assignee',
        adminRoleId: roleId,
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);
    const adminUserId = (created.json() as { data: { id: string } }).data.id;

    // While the assignee is live, the role is in use.
    const blocked = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      ...ADMIN,
    });
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ADMIN_ROLE_IN_USE,
    );

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-users/${adminUserId}`,
      ...ADMIN,
    });
    expect(removed.statusCode).toBe(204);

    // The row is still there, still carrying `adminRoleId` — soft delete keeps
    // it — so a count that forgot `deletedAt` still answers 1 here and the
    // guard refuses again.
    //
    // What the guard does **not** do is let the delete through: the row still
    // references the role, so Postgres refuses on `admin_users_admin_role_fk`
    // and the operator gets a 500. That is a defect of its own, it predates
    // this cut, and fixing it means deciding what a soft delete does to the
    // assignment — so this asserts only the predicate under test, and asserts
    // it by what the guard says rather than by the status the row's FK forces.
    const afterSoftDelete = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-roles/${roleId}`,
      ...ADMIN,
    });
    const refusal = (afterSoftDelete.json() as { error?: { code?: string } }).error?.code;
    expect(refusal).not.toBe(ERROR_CODES.ADMIN_ROLE_IN_USE);
  });
});
