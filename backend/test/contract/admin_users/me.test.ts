import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_PREFERENCES_DEFAULTS,
  ERROR_CODES,
  adminMeResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/**
 * `GET /api/v1/admin/me` is the auth-gate probe the admin SPA fires on
 * mount. Returns the current admin + their role + flat permission list,
 * 401 for anonymous callers.
 */

describe('GET /api/v1/admin/me', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the platform admin + wildcard permission list', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        adminUser: { id: string; email: string; status: string };
        role: { id: string; code: string; permissions: string[] } | null;
        permissions: string[];
      };
    };
    expect(body.data.adminUser.id).toBe(TEST_ADMIN_ID);
    expect(body.data.role?.id).toBe(PLATFORM_ADMIN_ROLE_ID);
    expect(body.data.permissions).toContain('*');
  });

  describe('preferences (feature 164, FR-016)', () => {
    // An admin of this file's own, so "nothing written yet" is true whatever
    // other files did to the shared stub admin.
    const FRESH_ADMIN_ID = '00000000-0000-4000-8000-0000000164a3';
    const fresh = { cookies: { b2b_session: 'stub-admin-preferences-fresh-session' } };

    beforeAll(async () => {
      const em = h.em();
      if (!(await em.findOne(AdminUser, { id: FRESH_ADMIN_ID }))) {
        em.create(AdminUser, {
          id: FRESH_ADMIN_ID,
          email: 'admin-preferences-fresh@example.com',
          passwordHash: 'x'.repeat(60),
          firstName: 'Fresh',
          lastName: 'Admin',
          adminRoleId: null,
          status: 'active',
        });
        await em.flush();
      }
      await em.execute(`delete from "admin_user_preferences" where "admin_user_id" = ?`, [
        FRESH_ADMIN_ID,
      ]);
    });

    it('parses with the published schema and carries the defaults before anything is written', async () => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/me', ...fresh });
      expect(res.statusCode).toBe(200);
      const data = (res.json() as { data: unknown }).data;
      // A strict copy: every key the auth gate is answered is declared (issue #599 §6).
      expect(disagreements(deepStrict(adminMeResponseSchema), data)).toEqual([]);
      const me = adminMeResponseSchema.parse(data);
      expect(me.preferences).toEqual(ADMIN_PREFERENCES_DEFAULTS);
    });

    it('carries the stored values after a PATCH', async () => {
      const write = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferences',
        ...fresh,
        payload: { sidebarPins: ['/orders'], sidebarRailMode: true, listPageSizes: { orders: 50 } },
      });
      expect(write.statusCode, write.body).toBe(200);
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/me', ...fresh });
      const me = adminMeResponseSchema.parse((res.json() as { data: unknown }).data);
      expect(me.preferences).toEqual({
        sidebarPins: ['/orders'],
        sidebarCollapsedGroups: [],
        sidebarRailMode: true,
        listPageSizes: { orders: 50 },
        // `specs/165-task-management/` R-14: the key reads as its default when nothing is stored.
        listViewModes: {},
      });
    });
  });

  it('rejects anonymous callers with 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});
