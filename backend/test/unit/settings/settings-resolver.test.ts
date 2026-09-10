import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
  SettingValueShapeMismatch,
  SettingsService,
} from '../../../src/kernel/settings/settings.service.js';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T048 — Resolver semantics for the universal getter (no Redis cache; the
 * cache is exercised separately in T047). Hosted under `unit/` for taxonomy
 * but uses the real test DB because the resolver is hard to mock cleanly.
 */
describe('SettingsService resolver (T048)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.beginTx();
  });

  async function ensureChannel(code: string): Promise<SalesChannel> {
    const em = db.em();
    const existing = await em.findOne(SalesChannel, { code });
    if (existing) return existing;
    const channel = em.create(SalesChannel, {
      code,
      name: { en: code },
      defaultLanguage: 'en',
      defaultCurrency: 'USD',
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    return channel;
  }

  it('returns the manifest default when no per-channel value exists', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'us3_resolver',
          groups: [],
          settings: [
            {
              code: 'us3.url',
              name: 'URL',
              valueType: 'string',
              defaultValue: 'https://default.example',
            },
          ],
        }),
      ]);
      const channel = await ensureChannel('us3_a');
      const service = new SettingsService(() => db.em());
      const v = await service.get('us3.url', channel.id, z.string());
      expect(v).toBe('https://default.example');
    } finally {
      await db.rollbackTx();
    }
  });

  it('returns the per-channel value when present', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'us3_resolver',
          groups: [],
          settings: [
            {
              code: 'us3.url',
              name: 'URL',
              valueType: 'string',
              defaultValue: 'https://default.example',
            },
          ],
        }),
      ]);
      const channel = await ensureChannel('us3_a');
      const setting = await em.findOneOrFail(Setting, { code: 'us3.url' });
      em.create(SettingValue, {
        setting,
        salesChannel: channel,
        value: 'https://override.example',
      });
      await em.flush();

      const service = new SettingsService(() => db.em());
      const v = await service.get('us3.url', channel.id, z.string());
      expect(v).toBe('https://override.example');
    } finally {
      await db.rollbackTx();
    }
  });

  it('throws SettingNotRegistered for an unknown code', async () => {
    try {
      const em = db.em();
      await new ManifestReconciler(em).apply([settingsManifest]);
      const channel = await ensureChannel('us3_a');
      const service = new SettingsService(() => db.em());
      await expect(
        service.get('does.not.exist', channel.id, z.string()),
      ).rejects.toBeInstanceOf(SettingNotRegistered);
    } finally {
      await db.rollbackTx();
    }
  });

  it('throws SettingOutOfScopeForChannel for a channel outside the setting scope', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      // Need to create channels first so the reconciler can resolve the
      // scope codes against them.
      const inScope = await ensureChannel('us3_in');
      await ensureChannel('us3_out');
      await reconciler.apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'us3_resolver',
          groups: [],
          settings: [
            {
              code: 'us3.scoped',
              name: 'Scoped',
              valueType: 'string',
              defaultValue: 'x',
              salesChannelCodes: ['us3_in'],
            },
          ],
        }),
      ]);

      const service = new SettingsService(() => db.em());
      // Request value for the in-scope channel — succeeds.
      const ok = await service.get('us3.scoped', inScope.id, z.string());
      expect(ok).toBe('x');

      // Out-of-scope channel — throws.
      const out = await em.findOneOrFail(SalesChannel, { code: 'us3_out' });
      await expect(
        service.get('us3.scoped', out.id, z.string()),
      ).rejects.toBeInstanceOf(SettingOutOfScopeForChannel);
    } finally {
      await db.rollbackTx();
    }
  });

  it('throws SettingValueShapeMismatch when the stored value fails the caller schema', async () => {
    try {
      const em = db.em();
      await new ManifestReconciler(em).apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'us3_resolver',
          groups: [],
          settings: [
            {
              code: 'us3.flag',
              name: 'Flag',
              valueType: 'boolean',
              defaultValue: true,
            },
          ],
        }),
      ]);
      const channel = await ensureChannel('us3_a');
      const service = new SettingsService(() => db.em());
      // Caller asserts a number; stored value is a boolean. Boom.
      await expect(
        service.get('us3.flag', channel.id, z.number()),
      ).rejects.toBeInstanceOf(SettingValueShapeMismatch);
    } finally {
      await db.rollbackTx();
    }
  });

  it('getMany returns per-code results without throwing on a single bad code', async () => {
    try {
      const em = db.em();
      await new ManifestReconciler(em).apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'us3_resolver',
          groups: [],
          settings: [
            { code: 'us3.a', name: 'A', valueType: 'string', defaultValue: 'a' },
            { code: 'us3.b', name: 'B', valueType: 'number', defaultValue: 42 },
          ],
        }),
      ]);
      const channel = await ensureChannel('us3_a');
      const service = new SettingsService(() => db.em());
      const map = await service.getMany(['us3.a', 'us3.b', 'does.not.exist'], channel.id);
      expect(map.get('us3.a')).toEqual({ ok: true, value: 'a' });
      expect(map.get('us3.b')).toEqual({ ok: true, value: 42 });
      expect(map.get('does.not.exist')).toMatchObject({ ok: false, error: 'not_registered' });
    } finally {
      await db.rollbackTx();
    }
  });
});
