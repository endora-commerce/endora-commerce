import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  defineModuleSettingsManifest,
  ERROR_CODES,
  SettingDetailResponseSchema,
  SettingDtoSchema,
  SettingsListResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { Setting } from '@endora-commerce/platform/kernel';

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
            code: 'us2_list.notes',
            name: 'Notes',
            groupCode: 'us2_list_group',
            valueType: 'string',
            defaultValue: '',
            multiline: true,
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
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it('lists groups including the test group with its setting', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    // Issue #599 §6 — every group and setting the platform registers is the published shape.
    expect(disagreements(deepStrict(SettingsListResponseSchema), r.json())).toEqual([]);
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
    expect(disagreements(deepStrict(SettingDetailResponseSchema), r.json())).toEqual([]);
    const body = r.json() as { code: string; valueType: string; defaultValue: unknown };
    expect(body.code).toBe('us2_list.title');
    expect(body.valueType).toBe('string');
    expect(body.defaultValue).toBe('default-title');
  });

  it('carries multiline on every setting of the list — true only where declared', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const body = SettingsListResponseSchema.parse(r.json());
    const all = body.groups.flatMap((g) => g.settings);
    // Every row answers, so a consumer never has to tell "false" from "old backend".
    expect(all.filter((s) => typeof s.multiline !== 'boolean').map((s) => s.code)).toEqual([]);
    const group = body.groups.find((g) => g.code === 'us2_list_group')!;
    expect(group.settings.find((s) => s.code === 'us2_list.notes')!.multiline).toBe(true);
    // Per setting, not per group or per module: the sibling that never
    // mentions the flag stays single-line beside the one that declares it.
    // (Asserted on this file's own fixture, deliberately: which shipped
    // manifests declare the flag is theirs to say and changes as they do.)
    expect(group.settings.find((s) => s.code === 'us2_list.title')!.multiline).toBe(false);
  });

  it('carries multiline on the detail response', async () => {
    const declared = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_list.notes',
      cookies: adminCookie,
    });
    expect(declared.statusCode).toBe(200);
    expect(SettingDtoSchema.parse(declared.json()).multiline).toBe(true);

    const plain = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_list.title',
      cookies: adminCookie,
    });
    expect(SettingDtoSchema.parse(plain.json()).multiline).toBe(false);
  });

  it('stores a multi-line value exactly, line breaks included', async () => {
    const text = 'User-agent: *\nDisallow: /a\r\n\n  indented\n';
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_list.notes/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: text },
    });
    expect(put.statusCode).toBe(200);
    expect(disagreements(deepStrict(SettingDtoSchema), put.json())).toEqual([]);
    const body = SettingDtoSchema.parse(put.json());
    expect(body.globalValue).toBe(text);
    expect(body.multiline).toBe(true);

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/us2_list.notes',
      cookies: adminCookie,
    });
    expect(SettingDtoSchema.parse(read.json()).globalValue).toBe(text);
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
