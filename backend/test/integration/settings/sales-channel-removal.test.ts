import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { settingsManifest } from '../../../src/modules/settings/manifest.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T054 — Sales-channel removal cascades correctly (FR-017).
 *
 * Deleting a SalesChannel must cascade-delete the per-channel
 * `setting_values` rows that referenced it; remaining rows on the same
 * setting (for other channels) MUST be preserved. Configured at the FK
 * level by migration 024_settings_init.ts.
 */
describe('sales-channel removal cascades to setting_values (T054)', () => {
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

  it('drops setting_values bound to the removed channel; keeps the rest', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'sc_rem',
          groups: [],
          settings: [
            {
              code: 'sc_rem.url',
              name: 'URL',
              valueType: 'string',
              defaultValue: 'https://default.example',
            },
          ],
        }),
      ]);

      // Two channels.
      const main = em.create(SalesChannel, {
        code: 'sc_rem_main',
        name: { en: 'Main' },
        defaultLanguage: 'en',
        defaultCurrency: 'USD',
        isPublic: true,
      });
      const wholesale = em.create(SalesChannel, {
        code: 'sc_rem_wholesale',
        name: { en: 'Wholesale' },
        defaultLanguage: 'en',
        defaultCurrency: 'USD',
        isPublic: false,
      });
      await em.persistAndFlush([main, wholesale]);

      const setting = await em.findOneOrFail(Setting, { code: 'sc_rem.url' });
      em.create(SettingValue, {
        setting,
        salesChannel: main,
        value: 'https://main.example',
      });
      em.create(SettingValue, {
        setting,
        salesChannel: wholesale,
        value: 'https://wholesale.example',
      });
      await em.flush();

      // Sanity: both rows exist.
      expect(await em.count(SettingValue, { setting })).toBe(2);

      // Delete one channel.
      em.remove(main);
      await em.flush();

      // Only the wholesale row should remain.
      const remaining = await em.find(
        SettingValue,
        { setting },
        { populate: ['salesChannel'] },
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.salesChannel.code).toBe('sc_rem_wholesale');
      expect(remaining[0]!.value).toBe('https://wholesale.example');
    } finally {
      await db.rollbackTx();
    }
  });
});
