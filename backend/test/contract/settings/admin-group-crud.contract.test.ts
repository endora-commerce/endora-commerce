import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SettingGroup } from '../../../src/kernel/settings/setting-group.entity.js';

/**
 * T032 — Contract test: group CRUD endpoints. Covers create, rename,
 * delete (rejection of `general`).
 */
describe('admin settings group CRUD (T032)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    const em = h.em();
    for (const g of await em.find(SettingGroup, { ownerModule: 'manual' })) em.remove(g);
    await em.flush();
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('creates a manual group with code/name/scope', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/settings/groups',
      cookies: adminCookie,
      payload: { code: 'us2_crud_group', name: 'CRUD Group', salesChannelCodes: ['pl_retail'] },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json() as { code: string; name: string; salesChannelCodes: string[] };
    expect(body.code).toBe('us2_crud_group');
    expect(body.salesChannelCodes).toEqual(['pl_retail']);
  });

  it('renames a group', async () => {
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/groups/us2_crud_group',
      cookies: adminCookie,
      payload: { name: 'Renamed Group' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { name: string };
    expect(body.name).toBe('Renamed Group');
  });

  it('rejects deletion of system-protected `general` group with 400 SETTING_GROUP_PROTECTED', async () => {
    const r = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/settings/groups/general',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SETTING_GROUP_PROTECTED,
    );
  });

  it('deletes a manual group with 204', async () => {
    const r = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/settings/groups/us2_crud_group',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(204);
  });

  it('returns 404 SETTING_GROUP_NOT_FOUND for an unknown code', async () => {
    const r = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/settings/groups/does_not_exist',
      cookies: adminCookie,
      payload: { name: 'x' },
    });
    expect(r.statusCode).toBe(404);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SETTING_GROUP_NOT_FOUND,
    );
  });
});
