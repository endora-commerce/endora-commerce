import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature: admin idle-logout timeout setting.
 *
 * The Settings module registers `admin.idle_logout_minutes` (General group,
 * number, default 60). The Admin UI reads it to drive its inactivity sign-out
 * timer. This contract test pins the registration + default.
 */
describe('Settings — admin.idle_logout_minutes', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is registered in the General group with default 60 and number type', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/admin.idle_logout_minutes',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json() as {
      code: string;
      valueType: string;
      defaultValue: unknown;
      groupCode?: string;
    };
    expect(dto.code).toBe('admin.idle_logout_minutes');
    expect(dto.valueType).toBe('number');
    expect(dto.defaultValue).toBe(60);
  });

  it('accepts a global override value', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/admin.idle_logout_minutes/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 30 },
    });
    expect(put.statusCode).toBe(200);
    const dto = put.json() as { globalValue: unknown };
    expect(dto.globalValue).toBe(30);
  });
});
