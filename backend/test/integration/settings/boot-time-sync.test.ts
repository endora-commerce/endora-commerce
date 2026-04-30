import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { settingsManifest } from '../../../src/modules/settings/manifest.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

/**
 * T019 — Boot-time idempotency for the manifest reconciler.
 *
 * Spec: when a module ships a manifest, repeated applications never duplicate
 * data and never overwrite admin-chosen `setting_values`. The reconciler is
 * the function `composeApp()` calls before HTTP routes start serving (T024).
 */
describe('boot-time manifest sync (T019)', () => {
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

  async function rollback() {
    await db.rollbackTx();
  }

  async function ensureChannel(em: ReturnType<TestDb['em']>): Promise<SalesChannel> {
    const existing = await em.findOne(SalesChannel, { code: 'main' });
    if (existing) return existing;
    const channel = em.create(SalesChannel, {
      code: 'main',
      name: { en: 'Main' },
      defaultLanguage: 'en',
      defaultCurrency: 'USD',
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    return channel;
  }

  it('seeds rows on first apply and is a no-op on a repeat apply', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);

      const catalogManifest = defineModuleSettingsManifest({
        moduleCode: 'catalog',
        groups: [{ code: 'sales_channels', name: 'Sales Channels' }],
        settings: [
          {
            code: 'sales_channels.base_url',
            name: 'Base URL',
            groupCode: 'sales_channels',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
        ],
      });

      const r1 = await reconciler.apply([settingsManifest, catalogManifest]);
      expect(r1.totalAddedSettings).toBe(1);

      const r2 = await reconciler.apply([settingsManifest, catalogManifest]);
      expect(r2.totalAddedSettings).toBe(0);
      expect(r2.totalAddedGroups).toBe(0);
    } finally {
      await rollback();
    }
  });

  it("does not overwrite an admin's per-channel value on re-apply", async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      const channel = await ensureChannel(em);

      const catalogManifest = defineModuleSettingsManifest({
        moduleCode: 'catalog',
        groups: [{ code: 'sales_channels', name: 'Sales Channels' }],
        settings: [
          {
            code: 'sales_channels.base_url',
            name: 'Base URL',
            groupCode: 'sales_channels',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
        ],
      });

      await reconciler.apply([settingsManifest, catalogManifest]);

      // Admin-chosen value (simulates what US2's admin service will do).
      const setting = (await em.findOneOrFail(Setting, {
        code: 'sales_channels.base_url',
      })) as Setting;
      const value = em.create(SettingValue, {
        setting,
        salesChannel: channel,
        value: 'https://admin-chosen.example',
      });
      await em.persistAndFlush(value);

      // Re-run the reconciler. The admin override must survive.
      await reconciler.apply([settingsManifest, catalogManifest]);

      const after = await em.findOneOrFail(SettingValue, {
        setting: { code: 'sales_channels.base_url' },
        salesChannel: { code: 'main' },
      });
      expect(after.value).toBe('https://admin-chosen.example');
    } finally {
      await rollback();
    }
  });
});
