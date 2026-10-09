import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, adminMeResponseSchema } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * `GET /api/v1/admin/me` carries the idle-logout policy.
 *
 * The admin shell signs an administrator out after `admin.idle_logout_minutes`
 * of inactivity. It used to learn that number from
 * `GET /api/v1/admin/settings/admin.idle_logout_minutes`, which is gated on
 * `settings:read` — so an administrator whose role lacks that permission got a
 * 403 on every sign-in and was held to the shell's built-in 60 minutes whatever
 * the operator had configured. The policy binds every administrator, so it
 * travels on the one response every administrator can read.
 *
 * The subject is therefore a role **without** `settings:read`: the platform
 * administrator holds `*` and would pass against either source. The settings
 * endpoint is asserted to still refuse that role — the repair moves the read,
 * it does not loosen the gate.
 */

// The id `test-actors.ts` maps `stub-channel-viewer-session` to.
const NARROW_ADMIN_ID = '00000000-0000-4000-8000-0000000000d2';
const platformAdmin = { b2b_session: 'stub-admin-session' };
const narrowAdmin = { b2b_session: 'stub-channel-viewer-session' };

describe('GET /api/v1/admin/me — idle-logout policy', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/channel_viewer',
      cookies: platformAdmin,
      payload: {
        code: 'channel_viewer',
        name: 'Channel viewer',
        permissions: ['sales_channels:read'],
      },
    });
    expect(role.statusCode).toBe(200);

    const em = h.em();
    em.create(AdminUser, {
      id: NARROW_ADMIN_ID,
      email: 'channel-viewer@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Channel',
      lastName: 'Viewer',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function readMe(cookies: Record<string, string>): Promise<unknown> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/me', cookies });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: unknown }).data;
  }

  it('answers the default to an administrator without settings:read', async () => {
    const me = adminMeResponseSchema.parse(await readMe(narrowAdmin));
    expect(me.permissions).toEqual(['sales_channels:read']);
    expect(me.idleLogoutMinutes).toBe(60);
  });

  it('answers the configured value to an administrator without settings:read', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/admin.idle_logout_minutes/value',
      cookies: platformAdmin,
      payload: { scope: 'all', value: 10 },
    });
    expect(put.statusCode).toBe(200);

    const me = adminMeResponseSchema.parse(await readMe(narrowAdmin));
    expect(me.idleLogoutMinutes).toBe(10);

    // The platform administrator reads the same policy from the same place.
    expect(adminMeResponseSchema.parse(await readMe(platformAdmin)).idleLogoutMinutes).toBe(10);
  });

  it('still refuses that administrator on the settings admin API', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/admin.idle_logout_minutes',
      cookies: narrowAdmin,
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});
