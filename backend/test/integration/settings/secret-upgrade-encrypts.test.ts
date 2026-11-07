import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest, type SettingValueType } from '@endora-commerce/contracts';
import { backfillPlaintextSecrets } from '@endora-commerce/platform/composition';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import {
  decryptSecretValue,
  isSecretEnvelope,
} from '../../../src/kernel/settings/secret-value-codec.js';

/**
 * Issue #700 — once a setting is `secret`, no plaintext copy of its value may
 * remain in `settings.global_value`, in `setting_values`, or in either layer of
 * the settings cache (Redis and the per-process LRU).
 *
 * Two routes lead there, and both are exercised against PostgreSQL and Redis:
 *
 *   - the reconciler applying `string` → `secret` (the type change #333 made
 *     for the S3/GCS credentials);
 *   - the boot backfill, for a database that already went through that type
 *     change before the reconciler encrypted anything.
 */

const KEY = randomBytes(32).toString('base64');
const MODULE = 'issue_700';
const UPGRADED = 'issue_700.upgraded_key';
const BACKFILLED = 'issue_700.backfilled_key';
const GLOBAL_PLAINTEXT = 'issue-700-global-plaintext';
const CHANNEL_PLAINTEXT = 'issue-700-channel-plaintext';

function manifest(valueType: SettingValueType) {
  return defineModuleSettingsManifest({
    moduleCode: MODULE,
    groups: [],
    settings: [
      { code: UPGRADED, name: 'Upgraded key', valueType, defaultValue: '' },
      { code: BACKFILLED, name: 'Backfilled key', valueType: 'secret', defaultValue: '' },
    ],
  });
}

describe('a setting that becomes secret keeps no plaintext (issue #700)', () => {
  let h: BackendServerHandle;
  let channel: SalesChannel;
  const previousKey = process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];

  async function storedValues(code: string): Promise<unknown[]> {
    const em = h.em();
    const globals = await em.execute<Array<{ global_value: unknown }>>(
      'select global_value from settings where code = ?',
      [code],
    );
    const perChannel = await em.execute<Array<{ value: unknown }>>(
      'select v.value from setting_values v join settings s on s.id = v.setting_id where s.code = ?',
      [code],
    );
    return [...globals.map((r) => r.global_value), ...perChannel.map((r) => r.value)];
  }

  async function redisValues(code: string): Promise<string[]> {
    const keys = await h.redis.keys(`settings:v1:${code}:*`);
    const values = await Promise.all(keys.map((k) => h.redis.get(k)));
    return values.filter((v): v is string => v !== null);
  }

  async function seedPlaintext(code: string): Promise<void> {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code });
    await em.nativeUpdate(Setting, { id: setting.id }, { globalValue: GLOBAL_PLAINTEXT });
    await em.nativeDelete(SettingValue, { setting: setting.id });
    await em.execute(
      'insert into setting_values (id, setting_id, sales_channel_id, value, created_at, updated_at) ' +
        "values (gen_random_uuid(), ?, ?, ?::jsonb, now(), now())",
      [setting.id, channel.id, JSON.stringify(CHANNEL_PLAINTEXT)],
    );
  }

  /** Read both tiers so both cache entries exist before the change under test. */
  async function warmCache(code: string): Promise<void> {
    const service = h.settings.settingsService;
    expect(await service.get(code, null, z.string())).toBe(GLOBAL_PLAINTEXT);
    expect(await service.get(code, channel.id, z.string())).toBe(CHANNEL_PLAINTEXT);
  }

  function assertNoPlaintext(values: readonly unknown[]): void {
    for (const value of values) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      expect(text).not.toContain(GLOBAL_PLAINTEXT);
      expect(text).not.toContain(CHANNEL_PLAINTEXT);
    }
  }

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = KEY;
    h = await setupBackendServer();
    channel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    await new ManifestReconciler(h.em()).apply([manifest('string')]);
  });

  afterAll(async () => {
    const em = h.em();
    for (const s of await em.find(Setting, { ownerModule: MODULE })) {
      await em.nativeDelete(SettingValue, { setting: s.id });
      em.remove(s);
    }
    await em.flush();
    await h.settings.cache.invalidate(UPGRADED);
    await h.settings.cache.invalidate(BACKFILLED);
    h.settings.cacheRegistration.dispose();
    await teardownBackendServer(h);
    if (previousKey === undefined) delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    else process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = previousKey;
  });

  it('string → secret: the reconciler encrypts both tables and drops the cache', async () => {
    await seedPlaintext(UPGRADED);
    await warmCache(UPGRADED);
    // The precondition the issue reports: the cache holds the plaintext.
    expect((await redisValues(UPGRADED)).join('\n')).toContain(GLOBAL_PLAINTEXT);

    await new ManifestReconciler(h.em(), {
      secretEncryptionKey: KEY,
      cache: h.settings.cache,
    }).apply([manifest('secret')]);

    const stored = await storedValues(UPGRADED);
    expect(stored).toHaveLength(2);
    for (const value of stored) expect(isSecretEnvelope(value)).toBe(true);
    assertNoPlaintext(stored);
    expect(await redisValues(UPGRADED)).toEqual([]);

    // Reads still answer the plaintext, and what they cache is the envelope.
    await warmCache(UPGRADED);
    const cached = await redisValues(UPGRADED);
    expect(cached).toHaveLength(2);
    assertNoPlaintext(cached);
    for (const raw of cached) expect(isSecretEnvelope(JSON.parse(raw))).toBe(true);
  });

  it('boot backfill: an already-secret code holding plaintext is encrypted once', async () => {
    await seedPlaintext(BACKFILLED);
    // A legacy plaintext secret is read before the backfill runs: it must not
    // reach the cache as plaintext either.
    await warmCache(BACKFILLED);
    assertNoPlaintext(await redisValues(BACKFILLED));

    const first = await backfillPlaintextSecrets(h.em(), {
      secretEncryptionKey: KEY,
      cache: h.settings.cache,
    });
    expect(first.encryptedCodes).toContain(BACKFILLED);

    const stored = await storedValues(BACKFILLED);
    expect(stored).toHaveLength(2);
    for (const value of stored) expect(isSecretEnvelope(value)).toBe(true);
    assertNoPlaintext(stored);
    expect(await redisValues(BACKFILLED)).toEqual([]);
    expect(decryptSecretValue(stored[0], KEY)).toBe(GLOBAL_PLAINTEXT);

    // Idempotent: the second boot re-encrypts nothing.
    const second = await backfillPlaintextSecrets(h.em(), {
      secretEncryptionKey: KEY,
      cache: h.settings.cache,
    });
    expect(second.encryptedCodes).not.toContain(BACKFILLED);
    expect(await storedValues(BACKFILLED)).toEqual(stored);

    await warmCache(BACKFILLED);
    assertNoPlaintext(await redisValues(BACKFILLED));
  });
});
