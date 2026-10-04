import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type AdminTenantScopePort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { PLATFORM_ADMIN_ROLE_ID, READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * An administrator always holds a role (owner decision of 2026-10-04).
 *
 * Two halves. The admin surface refuses every write that would leave an account
 * without a role, and protects the role installation guarantees. And an account
 * that has none anyway is refused by name — never treated as holding nothing,
 * and never as reaching every organization.
 */
describe('an administrator always holds a role', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const NO_ROLE = `stub-no-role-admin-${stamp}`;
  let noRoleAdminId: string;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // Written straight to the table: the surface refuses to create this state,
    // which is the point, and an instance upgraded from an earlier release may
    // still hold a row like it.
    const account = em.create(AdminUser, {
      email: `no-role-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      firstName: 'No',
      lastName: 'Role',
    });
    await em.persistAndFlush(account);
    noRoleAdminId = account.id;
    ADMIN_COOKIES[NO_ROLE] = { adminUserId: account.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[NO_ROLE];
    await teardownBackendServer(h);
  });

  describe('the admin surface cannot produce an account without a role', () => {
    const NEW_ADMIN = {
      email: `role-required-${stamp}@example.com`,
      password: 'super-strong-pass-123!',
      firstName: 'New',
      lastName: 'Admin',
    };

    it('refuses to create an administrator with no role, by name', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/admin-users',
        cookies: admin,
        payload: NEW_ADMIN,
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe(ERROR_CODES.ADMIN_USER_ROLE_REQUIRED);
      // The module's own sentence, not the raw code: the bundle carries it.
      expect(body.error.message).toContain('must hold a role');
      const explicitNull = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/admin-users',
        cookies: admin,
        payload: { ...NEW_ADMIN, adminRoleId: null },
      });
      expect(explicitNull.statusCode).toBe(400);
      expect((explicitNull.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.ADMIN_USER_ROLE_REQUIRED,
      );
    });

    it('refuses to clear the role of an administrator, and leaves it as it was', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/admin-users',
        cookies: admin,
        payload: { ...NEW_ADMIN, adminRoleId: READ_ONLY_ROLE_ID },
      });
      expect(created.statusCode).toBe(201);
      const { id } = (created.json() as { data: { id: string } }).data;

      const cleared = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/admin-users/${id}`,
        cookies: admin,
        payload: { adminRoleId: null },
      });
      expect(cleared.statusCode).toBe(400);
      expect((cleared.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.ADMIN_USER_ROLE_REQUIRED,
      );
      const row = await h.em().findOneOrFail(AdminUser, { id });
      expect(row.adminRoleId).toBe(READ_ONLY_ROLE_ID);
    });

    it('refuses to delete the platform-administrator role', async () => {
      const res = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/admin-roles/${PLATFORM_ADMIN_ROLE_ID}`,
        cookies: admin,
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.ADMIN_ROLE_PROTECTED,
      );
    });
  });

  describe('an account that has no role is refused by name', () => {
    it('is refused on a permission-gated route with ADMIN_ROLE_REQUIRED', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-users',
        cookies: { b2b_session: NO_ROLE },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe(ERROR_CODES.ADMIN_ROLE_REQUIRED);
      expect(body.error.message).toContain('has no role');
    });

    it('reaches no organization, and its scope carries the refusal rather than widening', async () => {
      const port = (h.container.cradle as unknown as { adminTenantScopePort: AdminTenantScopePort })
        .adminTenantScopePort;

      for (const id of [noRoleAdminId, '00000000-0000-4000-8000-00000000dead']) {
        const scope = await port.resolveForAdmin(id);
        expect(scope).toMatchObject({ allowAll: false, allowedOrganizationIds: [] });
        expect((scope as { unresolved?: unknown }).unresolved).toMatchObject({
          statusCode: 403,
          code: ERROR_CODES.ADMIN_ROLE_REQUIRED,
        });
      }
    });

    it('can still see who it is and that it holds no role', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/me',
        cookies: { b2b_session: NO_ROLE },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: { role: unknown; permissions: string[] } };
      expect(body.data.role).toBeNull();
      expect(body.data.permissions).toEqual([]);
    });
  });
});
