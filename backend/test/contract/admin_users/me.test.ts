import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';

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

  it('rejects anonymous callers with 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});
