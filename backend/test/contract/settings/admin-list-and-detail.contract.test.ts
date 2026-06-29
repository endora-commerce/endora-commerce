import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest, ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';

/**
 * T029 — Contract test: GET /api/v1/admin/settings + GET /:code.
 */
describe('admin settings list/detail (T029)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([
      defineModuleSettingsManifest({
        moduleCode: 'us2_test_list',
        groups: [
          { code: 'us2_list_group', name: 'US2 List Group' },
          { code: 'us2_mixed_group', name: 'US2 Mixed Group' },
          { code: 'us2_allhidden_group', name: 'US2 All-Hidden Group' },
        ],
        settings: [
          {
            code: 'us2_list.title',
            name: 'Title',
            groupCode: 'us2_list_group',
            valueType: 'string',
            defaultValue: 'default-title',
          },
          {
            code: 'us2_mixed.visible',
            name: 'Visible',
            groupCode: 'us2_mixed_group',
            valueType: 'string',
            defaultValue: 'shown',
          },
          {
            code: 'us2_mixed.hidden',
            name: 'Hidden',
            groupCode: 'us2_mixed_group',
            valueType: 'string',
            defaultValue: 'concealed',
            hidden: true,
          },
          {
            code: 'us2_allhidden.secret',
            name: 'All Hidden',
            groupCode: 'us2_allhidden_group',
            valueType: 'string',
            defaultValue: 'concealed',
            hidden: true,
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    // Clean up the test-specific module so the next test isn't polluted.
    const em = h.em();
    const settings = await em.find(Setting, { ownerModule: 'us2_test_list' });
    for (const s of settings) em.remove(s);
    await em.flush();
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('lists groups including the test group with its setting', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { groups: Array<{ code: string; settings: Array<{ code: string }> }> };
    const group = body.groups.find((g) => g.code === 'us2_list_group');
    expect(group).toBeTruthy();
    expect(group!.settings.some((s) => s.code === 'us2_list.title')).toBe(true);
  });

  it('excludes hidden settings but keeps visible siblings in their group', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { groups: Array<{ code: string; settings: Array<{ code: string }> }> };
    const mixed = body.groups.find((g) => g.code === 'us2_mixed_group');
    expect(mixed).toBeTruthy();
    const codes = mixed!.settings.map((s) => s.code);
    expect(codes).toContain('us2_mixed.visible');
    expect(codes).not.toContain('us2_mixed.hidden');
  });

  it('drops a group whose every setting is hidden', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      cookies: adminCookie,
    });
    const body = r.json() as { groups: Array<{ code: string }> };
    expect(body.groups.some((g) => g.code === 'us2_allhidden_group')).toBe(false);
  });

  it('still resolves a hidden setting by code (dedicated-surface access)', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_mixed.hidden',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { code: string };
    expect(body.code).toBe('us2_mixed.hidden');
  });

  it('returns the setting detail with an ETag header', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_list.title',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers.etag).toBeTruthy();
    const body = r.json() as { code: string; valueType: string; defaultValue: unknown };
    expect(body.code).toBe('us2_list.title');
    expect(body.valueType).toBe('string');
    expect(body.defaultValue).toBe('default-title');
  });

  it('returns 404 SETTING_NOT_REGISTERED for an unknown code', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/does.not.exist',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(404);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.SETTING_NOT_REGISTERED);
  });
});
