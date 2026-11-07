import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { ManifestReconciler } from './manifest-reconciler.js';
import { backfillPlaintextSecrets } from './plaintext-secret-backfill.js';
import { decryptSecretValue, isSecretEnvelope } from './secret-value-codec.js';
import { Setting } from './setting.entity.js';
import { SettingGroup } from './setting-group.entity.js';
import { SettingValue } from './setting-value.entity.js';
import type { SettingsCache, SettingsCacheInvalidation } from './settings-cache.js';
import { SettingsService } from './settings.service.js';
import { SalesChannel } from '../sales-channels/sales-channel.entity.js';

/**
 * Issue #700 — a setting that becomes `secret` must not keep its stored
 * plaintext, in either value table or in the settings cache.
 *
 * The reconciler and the boot backfill touch only a handful of `EntityManager`
 * calls, so they run here against an in-memory stand-in; the same path against
 * PostgreSQL and Redis is `backend/test/integration/settings/secret-upgrade-encrypts.test.ts`.
 */

const KEY = randomBytes(32).toString('base64');
const CHANNEL_ID = '7d1f2c4e-1b9a-4c3e-9f7a-2d8e6b5a4c31';

type Row = Record<string, unknown>;

interface FakeDb {
  em: EntityManager;
  settings: Row[];
  values: Row[];
  flushes: () => number;
}

function collection(items: Row[] = []) {
  return { getItems: () => items, add: (item: Row) => items.push(item) };
}

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([field, expected]) => {
    const actual = row[field];
    if (expected && typeof expected === 'object' && '$in' in expected) {
      const ids = (expected as { $in: unknown[] }).$in;
      const id = actual && typeof actual === 'object' ? (actual as Row)['id'] : actual;
      return ids.includes(id);
    }
    return actual === expected;
  });
}

function fakeDb(seed: { settings: Row[]; values?: Row[] }): FakeDb {
  const general: Row = {
    id: 'group-general',
    code: 'general',
    name: 'General',
    ownerModule: 'settings',
    salesChannels: collection(),
  };
  const groups: Row[] = [general];
  const settings: Row[] = seed.settings.map((s) => ({
    group: general,
    ownerModule: 'issue_700',
    description: null,
    enumOptions: null,
    configurationType: null,
    hidden: false,
    multiline: false,
    globalValue: null,
    salesChannels: collection(),
    ...s,
  }));
  const values = (seed.values ?? []).map((v) => ({
    ...v,
    setting: settings.find((s) => s['code'] === v['settingCode']),
    salesChannel: { id: CHANNEL_ID },
  }));
  const table = (entity: unknown): Row[] => {
    if (entity === Setting) return settings;
    if (entity === SettingGroup) return groups;
    if (entity === SettingValue) return values;
    if (entity === SalesChannel) return [];
    throw new Error('fake em: unexpected entity');
  };
  let flushes = 0;
  const em = {
    find: async (entity: unknown, where: Row = {}) =>
      table(entity).filter((row) => matches(row, where)),
    findOne: async (entity: unknown, where: Row) => {
      if (entity === SettingValue && where['salesChannel']) {
        const channelId = (where['salesChannel'] as Row)['id'];
        return (
          values.find(
            (v) => v['setting'] === where['setting'] && (v['salesChannel'] as Row)['id'] === channelId,
          ) ?? null
        );
      }
      return table(entity).find((row) => matches(row, where)) ?? null;
    },
    persist: () => em,
    flush: async () => {
      flushes += 1;
    },
  };
  return {
    em: em as unknown as EntityManager,
    settings,
    values,
    flushes: () => flushes,
  };
}

function fakeInvalidation(): SettingsCacheInvalidation & { dropped: string[] } {
  const dropped: string[] = [];
  return {
    dropped,
    invalidateAfterWrite: async (code: string) => {
      dropped.push(code);
      return 1;
    },
    invalidateAllAfterWrite: async () => 0,
  };
}

const UPGRADED = 'issue_700.api_key';

function upgradeManifest() {
  return defineModuleSettingsManifest({
    moduleCode: 'issue_700',
    groups: [],
    settings: [{ code: UPGRADED, name: 'API key', valueType: 'secret', defaultValue: '' }],
  });
}

function upgradeSeed() {
  return {
    settings: [
      {
        id: 'setting-1',
        code: UPGRADED,
        name: 'API key',
        valueType: 'string',
        defaultValue: '',
        globalValue: 'global-plaintext',
      },
    ],
    values: [
      { id: 'value-1', settingCode: UPGRADED, value: 'channel-plaintext' },
      { id: 'value-2', settingCode: UPGRADED, value: '' },
    ],
  };
}

describe('ManifestReconciler — string → secret upgrade (issue #700)', () => {
  it('encrypts every stored value of the upgraded code and drops its cache entries', async () => {
    const db = fakeDb(upgradeSeed());
    const cache = fakeInvalidation();
    const warnings: string[] = [];

    await new ManifestReconciler(db.em, {
      secretEncryptionKey: KEY,
      cache,
      warn: (m) => warnings.push(m),
    }).apply([upgradeManifest()]);

    const setting = db.settings[0]!;
    expect(setting['valueType']).toBe('secret');
    expect(isSecretEnvelope(setting['globalValue'])).toBe(true);
    expect(decryptSecretValue(setting['globalValue'], KEY)).toBe('global-plaintext');
    expect(isSecretEnvelope(db.values[0]!['value'])).toBe(true);
    expect(decryptSecretValue(db.values[0]!['value'], KEY)).toBe('channel-plaintext');
    // An empty value is "not set", and encrypting it would make it look set.
    expect(db.values[1]!['value']).toBe('');
    expect(cache.dropped).toEqual([UPGRADED]);
    expect(warnings).toEqual([]);
  });

  it('without a key, warns naming the code and leaves the values as they are', async () => {
    const db = fakeDb(upgradeSeed());
    const cache = fakeInvalidation();
    const warnings: string[] = [];

    await new ManifestReconciler(db.em, { cache, warn: (m) => warnings.push(m) }).apply([
      upgradeManifest(),
    ]);

    expect(db.settings[0]!['valueType']).toBe('secret');
    expect(db.settings[0]!['globalValue']).toBe('global-plaintext');
    expect(db.values[0]!['value']).toBe('channel-plaintext');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(UPGRADED);
    expect(warnings[0]).toContain('SETTINGS_SECRET_ENCRYPTION_KEY');
    // The plaintext a process cached before the type changed still goes.
    expect(cache.dropped).toEqual([UPGRADED]);
  });

  it('does not write anything on a dry run', async () => {
    const db = fakeDb(upgradeSeed());
    await new ManifestReconciler(db.em, { secretEncryptionKey: KEY }).apply(
      [upgradeManifest()],
      { dryRun: true },
    );
    expect(db.settings[0]!['globalValue']).toBe('global-plaintext');
    expect(db.flushes()).toBe(0);
  });
});

describe('backfillPlaintextSecrets — boot backfill (issue #700)', () => {
  function alreadyUpgradedSeed(envelope: unknown) {
    return {
      settings: [
        {
          id: 'setting-1',
          code: 'assets.s3.secret_access_key',
          valueType: 'secret',
          defaultValue: '',
          globalValue: 'plaintext-s3-secret',
        },
        {
          id: 'setting-2',
          code: 'assets.gcs.service_account_json',
          valueType: 'secret',
          defaultValue: '',
          globalValue: envelope,
        },
        {
          id: 'setting-3',
          code: 'assets.s3.bucket',
          valueType: 'string',
          defaultValue: '',
          globalValue: 'my-bucket',
        },
      ],
      values: [
        { id: 'value-1', settingCode: 'assets.gcs.service_account_json', value: '{"k":1}' },
      ],
    };
  }

  it('encrypts non-envelope values of secret settings and nothing else', async () => {
    const envelope = { v: 1, alg: 'aes-256-gcm', iv: 'aXY=', ct: 'Y3Q=', tag: 'dGFn' };
    const db = fakeDb(alreadyUpgradedSeed(envelope));
    const cache = fakeInvalidation();

    const outcome = await backfillPlaintextSecrets(db.em, { secretEncryptionKey: KEY, cache });

    expect(decryptSecretValue(db.settings[0]!['globalValue'], KEY)).toBe('plaintext-s3-secret');
    // Already an envelope: untouched — the same object, not a re-encryption.
    expect(db.settings[1]!['globalValue']).toBe(envelope);
    expect(decryptSecretValue(db.values[0]!['value'], KEY)).toBe('{"k":1}');
    // Not a secret: never touched.
    expect(db.settings[2]!['globalValue']).toBe('my-bucket');
    expect([...outcome.encryptedCodes].sort()).toEqual([
      'assets.gcs.service_account_json',
      'assets.s3.secret_access_key',
    ]);
    expect([...cache.dropped].sort()).toEqual([...outcome.encryptedCodes].sort());
    expect(db.flushes()).toBe(1);
  });

  it('is idempotent: a second run re-encrypts nothing and writes nothing', async () => {
    const db = fakeDb(alreadyUpgradedSeed(null));
    await backfillPlaintextSecrets(db.em, { secretEncryptionKey: KEY });
    const first = db.settings[0]!['globalValue'];
    const firstValue = db.values[0]!['value'];

    const cache = fakeInvalidation();
    const outcome = await backfillPlaintextSecrets(db.em, { secretEncryptionKey: KEY, cache });

    expect(db.settings[0]!['globalValue']).toBe(first);
    expect(db.values[0]!['value']).toBe(firstValue);
    expect(outcome.encryptedCodes).toEqual([]);
    expect(cache.dropped).toEqual([]);
    expect(db.flushes()).toBe(1);
  });

  it('without a key, warns per code, leaves the values, and drops their cache entries', async () => {
    const db = fakeDb(alreadyUpgradedSeed(null));
    const cache = fakeInvalidation();
    const warnings: string[] = [];

    const outcome = await backfillPlaintextSecrets(db.em, {
      cache,
      warn: (m) => warnings.push(m),
    });

    expect(db.settings[0]!['globalValue']).toBe('plaintext-s3-secret');
    expect(db.values[0]!['value']).toBe('{"k":1}');
    expect(outcome.encryptedCodes).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes('assets.s3.secret_access_key'))).toBe(true);
    expect(warnings.some((w) => w.includes('assets.gcs.service_account_json'))).toBe(true);
    expect([...cache.dropped].sort()).toEqual([
      'assets.gcs.service_account_json',
      'assets.s3.secret_access_key',
    ]);
    expect(db.flushes()).toBe(0);
  });

  it('with a malformed key, warns rather than failing the boot', async () => {
    const db = fakeDb(alreadyUpgradedSeed(null));
    const warnings: string[] = [];
    await backfillPlaintextSecrets(db.em, {
      secretEncryptionKey: Buffer.from('short').toString('base64'),
      warn: (m) => warnings.push(m),
    });
    expect(db.settings[0]!['globalValue']).toBe('plaintext-s3-secret');
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('SettingsService — a secret is never cached as plaintext (issue #700)', () => {
  function cacheSpy(): { cache: SettingsCache; stored: unknown[] } {
    const stored: unknown[] = [];
    const cache = {
      get: async () => ({ hit: false }),
      set: async (_code: string, _channel: string | null, value: unknown) => {
        stored.push(value);
      },
      setNotRegistered: async () => undefined,
    };
    return { cache: cache as unknown as SettingsCache, stored };
  }

  function legacyDb() {
    return fakeDb({
      settings: [
        {
          id: 'setting-1',
          code: 'issue_700.legacy',
          valueType: 'secret',
          defaultValue: '',
          globalValue: 'legacy-plaintext',
        },
      ],
      values: [{ id: 'value-1', settingCode: 'issue_700.legacy', value: 'channel-plaintext' }],
    });
  }

  it('caches an envelope, and still returns the plaintext, when a key is configured', async () => {
    const db = legacyDb();
    const { cache, stored } = cacheSpy();
    const service = new SettingsService(() => db.em, cache, KEY);

    expect(await service.get('issue_700.legacy', null, z.string())).toBe('legacy-plaintext');
    const many = await service.getMany(['issue_700.legacy'], CHANNEL_ID);
    expect(many.get('issue_700.legacy')).toEqual({ ok: true, value: 'channel-plaintext' });

    expect(stored).toHaveLength(2);
    for (const value of stored) expect(isSecretEnvelope(value)).toBe(true);
    expect(decryptSecretValue(stored[0], KEY)).toBe('legacy-plaintext');
    expect(decryptSecretValue(stored[1], KEY)).toBe('channel-plaintext');
  });

  it('does not cache the value at all without a key', async () => {
    const db = legacyDb();
    const { cache, stored } = cacheSpy();
    const service = new SettingsService(() => db.em, cache);

    expect(await service.get('issue_700.legacy', null, z.string())).toBe('legacy-plaintext');
    await service.getMany(['issue_700.legacy'], CHANNEL_ID);

    expect(stored).toEqual([]);
  });
});
