import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest, ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { SettingsAdminService } from '../../../src/modules/settings/services/settings-admin.service.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { isSecretEnvelope } from '../../../src/kernel/settings/secret-value-codec.js';
import { z } from 'zod';

/**
 * T005 — contract tests for the Settings `secret` value type (feature 043,
 * FR-021 / contracts/settings-secret-type.md):
 *   - list + detail redaction (value null, isSet flags correct, set & unset)
 *   - write→read round-trip stays redacted; stored value is an envelope
 *   - audit rows carry '[redacted]' instead of the plaintext
 *   - SettingsService.get returns the decrypted plaintext to backend callers
 *   - non-secret DTOs are unchanged (no stray isSet fields)
 *   - SETTING_SECRET_KEY_MISSING on write without the env key
 */

const TEST_KEY = randomBytes(32).toString('base64');

describe('settings secret redaction (T005)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = TEST_KEY;
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([
      defineModuleSettingsManifest({
        moduleCode: 'secret_test',
        groups: [],
        settings: [
          {
            code: 'secret_test.api_key',
            name: 'Secret test API key',
            valueType: 'secret',
            defaultValue: '',
          },
          {
            code: 'secret_test.plain',
            name: 'Plain companion setting',
            valueType: 'string',
            defaultValue: 'visible-default',
          },
        ],
      }),
    ]);
  });

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: 'secret_test' })) {
      for (const v of await em.find(SettingValue, { setting: s })) em.remove(v);
      em.remove(s);
    }
    await em.flush();
    await teardownBackendServer(h);
    delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
  });

  it('manifests cannot declare a secret with a non-empty default', () => {
    expect(() =>
      defineModuleSettingsManifest({
        moduleCode: 'secret_test_bad',
        groups: [],
        settings: [
          {
            code: 'secret_test_bad.key',
            name: 'Bad',
            valueType: 'secret',
            defaultValue: 'leaked-credential',
          },
        ],
      }),
    ).toThrow();
  });

  it('detail endpoint redacts an UNSET secret (null values, isSet=false)', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/secret_test.api_key',
      cookies: adminCookie,
    });
    expect(r.statusCode).toBe(200);
    const dto = r.json() as Record<string, unknown>;
    expect(dto['valueType']).toBe('secret');
    expect(dto['defaultValue']).toBeNull();
    expect(dto['globalValue']).toBeNull();
    expect(dto['globalValueIsSet']).toBe(false);
  });

  it('write accepts plaintext, stores an envelope, and every read stays redacted', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/secret_test.api_key/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: 'sk-live-supersecret-123' },
    });
    expect(put.statusCode).toBe(200);
    const putDto = put.json() as Record<string, unknown>;
    expect(putDto['globalValue']).toBeNull();
    expect(putDto['globalValueIsSet']).toBe(true);
    expect(JSON.stringify(putDto)).not.toContain('sk-live-supersecret-123');

    // Stored value is a ciphertext envelope, not plaintext.
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'secret_test.api_key' });
    expect(isSecretEnvelope(setting.globalValue)).toBe(true);
    expect(JSON.stringify(setting.globalValue)).not.toContain('sk-live-supersecret-123');

    // Detail read: redacted with isSet=true.
    const detail = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/secret_test.api_key',
      cookies: adminCookie,
    });
    const detailDto = detail.json() as Record<string, unknown>;
    expect(detailDto['globalValue']).toBeNull();
    expect(detailDto['globalValueIsSet']).toBe(true);
    expect(JSON.stringify(detailDto)).not.toContain('sk-live-supersecret-123');

    // List read: same redaction.
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings',
      cookies: adminCookie,
    });
    expect(JSON.stringify(list.json())).not.toContain('sk-live-supersecret-123');
  });

  it('audit rows never carry the secret plaintext', async () => {
    const em = h.em();
    const audits = await em.find(AuditLogEntry, {
      action: 'setting.global_value_set',
      objectType: 'setting',
    });
    const mine = audits.filter(
      (a) =>
        (a.stateAfter as { settingCode?: string } | undefined)?.settingCode ===
        'secret_test.api_key',
    );
    expect(mine.length).toBeGreaterThan(0);
    for (const a of mine) {
      expect(JSON.stringify(a.stateAfter)).not.toContain('sk-live-supersecret-123');
      expect((a.stateAfter as { value?: unknown }).value).toBe('[redacted]');
    }
  });

  it('SettingsService.get returns the decrypted plaintext to backend callers', async () => {
    const channelId = await firstChannelId();
    const value = await h.settings.settingsService.get(
      'secret_test.api_key',
      channelId,
      z.string(),
    );
    expect(value).toBe('sk-live-supersecret-123');
  });

  it('non-secret settings are byte-identical to the pre-043 shape (no isSet fields)', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/settings/secret_test.plain',
      cookies: adminCookie,
    });
    const dto = r.json() as Record<string, unknown>;
    expect(dto['defaultValue']).toBe('visible-default');
    expect('globalValueIsSet' in dto).toBe(false);
    const channels = dto['valuesByChannel'] as Array<Record<string, unknown>>;
    for (const c of channels) expect('isSet' in c).toBe(false);
  });

  it('clearing with an empty string flips isSet back to false', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/secret_test.api_key/value',
      cookies: adminCookie,
      payload: { scope: 'all', value: '' },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as Record<string, unknown>)['globalValueIsSet']).toBe(false);
  });

  it('write without the env key fails with SETTING_SECRET_KEY_MISSING (no silent plaintext)', async () => {
    // An admin service composed without the key (the HTTP envelope mapping of
    // HttpError → 500 is shared machinery covered by other settings tests).
    const keyless = new SettingsAdminService(h.em, h.eventBus, undefined, undefined);
    let thrown: unknown;
    try {
      await keyless.setValueForAllChannels(
        'secret_test.api_key',
        'should-not-be-stored',
        null,
        { actorAdminUserId: null },
      );
    } catch (err) {
      thrown = err;
    }
    const httpErr = thrown as { statusCode?: number; code?: string } | undefined;
    expect(httpErr?.statusCode).toBe(500);
    expect(httpErr?.code).toBe(ERROR_CODES.SETTING_SECRET_KEY_MISSING);

    // Nothing was persisted.
    const em = h.em();
    em.clear();
    const setting = await em.findOneOrFail(Setting, { code: 'secret_test.api_key' });
    expect(JSON.stringify(setting.globalValue ?? null)).not.toContain('should-not-be-stored');
  });

  async function firstChannelId(): Promise<string> {
    const em = h.em();
    const rows = await em.getConnection().execute<{ id: string }[]>(
      `select id from sales_channels order by code limit 1`,
    );
    return rows[0]!.id;
  }
});
