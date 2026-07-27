import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingGroup } from '../../../src/modules/settings/entities/setting-group.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * Feature 058 US2 (T037) — one configuration referenced by two settings [real DB].
 *
 * Update-key-once propagates to both resolutions; delete is blocked with
 * CREDENTIAL_IN_USE listing every referrer (global + per-channel).
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const CODE = 'reuse-llm';
const GLOBAL_SETTING = 'credentials_test.ref_global';
const CHANNEL_SETTING = 'credentials_test.ref_channel';

describe('Credentials reuse + delete guard [real DB]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();

    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: CODE,
        name: 'Reused LLM',
        typeCode: 'llm',
        providerCode: 'anthropic',
        values: { apiKey: 'sk-first', model: 'm1' },
      },
      ...ADMIN,
    });

    // Two credential_ref settings referencing the same configuration: one via a
    // global override, one via a per-channel value.
    const em = h.em();
    const group = await em.findOneOrFail(SettingGroup, { code: 'general' });
    const channel = await em.findOneOrFail(SalesChannel, { systemDefault: true });

    const sGlobal = em.create(Setting, {
      code: GLOBAL_SETTING,
      name: 'Ref (global)',
      group,
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
      globalValue: CODE,
      ownerModule: 'credentials_test',
    });
    const sChannel = em.create(Setting, {
      code: CHANNEL_SETTING,
      name: 'Ref (channel)',
      group,
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
      ownerModule: 'credentials_test',
    });
    await em.persistAndFlush([sGlobal, sChannel]);
    const channelValue = em.create(SettingValue, {
      setting: sChannel,
      salesChannel: channel,
      value: CODE,
    });
    await em.persistAndFlush(channelValue);
  });

  afterAll(async () => {
    // Clean up the test-only settings (the settings table is not truncated).
    const em = h.em();
    await em.nativeDelete(SettingValue, { setting: { code: CHANNEL_SETTING } });
    await em.nativeDelete(Setting, { code: { $in: [GLOBAL_SETTING, CHANNEL_SETTING] } });
    await teardownBackendServer(h);
  });

  it('lists both referrers (global + per-channel)', async () => {
    const refs = await h.settings.settingsService.listReferencesToConfiguration(CODE);
    const codes = refs.map((r) => r.settingCode).sort();
    expect(codes).toEqual([CHANNEL_SETTING, GLOBAL_SETTING]);
    expect(refs.some((r) => r.settingCode === CHANNEL_SETTING && r.salesChannelCode)).toBe(true);
  });

  it('blocks delete with CREDENTIAL_IN_USE listing the referrers', async () => {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/credentials/${CODE}`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CREDENTIAL_IN_USE');
    const referencedBy = res.json().error.details.referencedBy as { settingCode: string }[];
    expect(referencedBy.map((r) => r.settingCode).sort()).toEqual([CHANNEL_SETTING, GLOBAL_SETTING]);
  });

  it('propagates a single key update to every referencing resolution', async () => {
    // Update the shared configuration's secret + model once.
    const updated = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/credentials/${CODE}`,
      payload: { values: { apiKey: 'sk-second', model: 'm2' } },
      ...ADMIN,
    });
    expect(updated.statusCode).toBe(200);

    // Both settings hold the same configuration code, so both resolve to the
    // one updated configuration.
    const ref = CODE;
    const result = await h.credentials.service.resolve(ref);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.values['apiKey']).toBe('sk-second');
      expect(result.values['model']).toBe('m2');
    }
  });

  it('allows delete once no setting references it', async () => {
    const em = h.em();
    await em.nativeDelete(SettingValue, { setting: { code: CHANNEL_SETTING } });
    await em.nativeDelete(Setting, { code: { $in: [GLOBAL_SETTING, CHANNEL_SETTING] } });

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/credentials/${CODE}`,
      ...ADMIN,
    });
    expect(res.statusCode).toBe(204);
  });
});
