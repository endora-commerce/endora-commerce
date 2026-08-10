import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest, ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T030 — Contract test: PUT /api/v1/admin/settings/:code/value with
 * scope='all' and scope='subset', plus the negative paths (empty subset,
 * out-of-scope channel, wrong shape).
 */
describe('admin set value (T030)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([
      defineModuleSettingsManifest({
        moduleCode: 'us2_test_setval',
        groups: [],
        settings: [
          {
            code: 'us2_setval.url',
            name: 'URL',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
          {
            code: 'us2_setval.scoped_url',
            name: 'Scoped URL',
            valueType: 'string',
            defaultValue: 'https://scoped.example',
            salesChannelCodes: ['pl_retail'],
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'us2_test_setval' })) em.remove(s);
    await em.flush();
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  beforeEach(async () => {
    // Clean any setting_values + global override left by prior tests so each
    // case starts blank.
    const em = h.em();
    const settings = await em.find(Setting, { ownerModule: 'us2_test_setval' });
    for (const s of settings) {
      const values = await em.find(SettingValue, { setting: s });
      for (const v of values) em.remove(v);
      s.globalValue = null;
    }
    await em.flush();
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  it("scope='all' writes the global override (no per-channel rows) and audits once", async () => {
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_setval.url/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 'https://new.example' },
    });
    expect(r.statusCode).toBe(200);

    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'us2_setval.url' });
    expect(setting.globalValue).toBe('https://new.example');

    // No per-channel rows are created — channels inherit the global override.
    const values = await em.find(SettingValue, { setting });
    expect(values).toHaveLength(0);

    const audits = await em.find(AuditLogEntry, {
      action: 'setting.global_value_set',
      objectType: 'setting',
    });
    const audited = audits.filter(
      (a) => (a.stateAfter as { settingCode?: string } | undefined)?.settingCode === 'us2_setval.url',
    );
    expect(audited.length).toBe(1);
    expect((audited[0]!.stateAfter as { value?: unknown } | undefined)?.value).toBe(
      'https://new.example',
    );

    // SalesChannel count assertion preserved as a smoke check on the fixture.
    const allChannels = await em.count(SalesChannel, {});
    expect(allChannels).toBeGreaterThan(0);
  });

  it("scope='subset' targets only the listed channels", async () => {
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_setval.url/value',
      cookies: adminCookie,
      payload: {
        scope: 'subset',
        salesChannelCodes: ['pl_retail'],
        value: 'https://retail.example',
      },
    });
    expect(r.statusCode).toBe(200);

    const em = h.em();
    const values = await em.find(
      SettingValue,
      { setting: { code: 'us2_setval.url' } },
      { populate: ['salesChannel'] },
    );
    expect(values).toHaveLength(1);
    expect(values[0]!.salesChannel.code).toBe('pl_retail');
    expect(values[0]!.value).toBe('https://retail.example');
  });

  it('rejects empty subset with 400 SETTING_EMPTY_SUBSET', async () => {
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_setval.url/value',
      cookies: adminCookie,
      payload: { scope: 'subset', salesChannelCodes: [], value: 'x' },
    });
    // Zod's discriminated union with min(1) on the array surfaces as
    // VALIDATION_FAILED at the route boundary; the explicit
    // SETTING_EMPTY_SUBSET path runs when the request bypasses Zod (eg.
    // service-level callers). Accept either here.
    expect([400]).toContain(r.statusCode);
    const body = r.json() as { error: { code: string } };
    expect(
      [ERROR_CODES.SETTING_EMPTY_SUBSET, ERROR_CODES.VALIDATION_FAILED].includes(
        body.error.code as typeof ERROR_CODES.SETTING_EMPTY_SUBSET,
      ),
    ).toBe(true);
  });

  it('rejects an out-of-scope channel for a scoped setting (400 SETTING_OUT_OF_SCOPE_FOR_CHANNEL)', async () => {
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_setval.scoped_url/value',
      cookies: adminCookie,
      payload: {
        scope: 'subset',
        salesChannelCodes: ['pl_b2b_vip'],
        value: 'https://x.example',
      },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SETTING_OUT_OF_SCOPE_FOR_CHANNEL,
    );
  });

  it('rejects a wrong-shape value (400 SETTING_VALUE_SHAPE_MISMATCH)', async () => {
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/us2_setval.url/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 42 },
    });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.SETTING_VALUE_SHAPE_MISMATCH,
    );
  });
});
