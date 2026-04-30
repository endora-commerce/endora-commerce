import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { settingsManifest } from '../../../src/modules/settings/manifest.js';
import { SettingsAdminService } from '../../../src/modules/settings/services/settings-admin.service.js';
import { Setting } from '../../../src/modules/settings/entities/setting.entity.js';
import { SettingValue } from '../../../src/modules/settings/entities/setting-value.entity.js';
import { SalesChannel } from '../../../src/modules/catalog/entities/sales-channel.entity.js';
import { EventBus } from '../../../src/events/bus.js';

/**
 * T033 — Group deletion reassigns owned settings to `general` and preserves
 * their per-channel values byte-for-byte.
 */
describe('group delete reassigns to general (T033)', () => {
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

  it('reassigns owned settings to general; setting_values survive', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([
        settingsManifest,
        defineModuleSettingsManifest({
          moduleCode: 'gd_test',
          groups: [{ code: 'gd_group', name: 'GD Group' }],
          settings: [
            {
              code: 'gd_test.url',
              name: 'URL',
              groupCode: 'gd_group',
              valueType: 'string',
              defaultValue: 'https://default.example',
            },
          ],
        }),
      ]);

      const channel =
        (await em.findOne(SalesChannel, { code: 'main' })) ??
        em.create(SalesChannel, {
          code: 'main',
          name: { en: 'Main' },
          defaultLanguage: 'en',
          defaultCurrency: 'USD',
          isPublic: true,
        });
      if (!(await em.findOne(SalesChannel, { id: channel.id }))) {
        await em.persistAndFlush(channel);
      }

      // Admin sets a per-channel value.
      const setting = await em.findOneOrFail(Setting, { code: 'gd_test.url' });
      em.create(SettingValue, {
        setting,
        salesChannel: channel,
        value: 'https://chosen.example',
      });
      await em.flush();

      // Delete the owning group.
      const adminService = new SettingsAdminService(() => db.em(), new EventBus());
      await adminService.deleteGroup('gd_group', { actorAdminUserId: null });

      // Setting was reassigned to general; its values survived.
      const after = await db
        .em()
        .findOneOrFail(Setting, { code: 'gd_test.url' }, { populate: ['group'] });
      expect(after.group.code).toBe('general');

      const value = await db.em().findOne(SettingValue, {
        setting: { code: 'gd_test.url' },
        salesChannel: { code: 'main' },
      });
      expect(value?.value).toBe('https://chosen.example');
    } finally {
      await db.rollbackTx();
    }
  });

  it('refuses to delete the system-protected general group', async () => {
    try {
      const em = db.em();
      await new ManifestReconciler(em).apply([settingsManifest]);
      const adminService = new SettingsAdminService(() => db.em(), new EventBus());
      await expect(
        adminService.deleteGroup('general', { actorAdminUserId: null }),
      ).rejects.toMatchObject({ code: 'SETTING_GROUP_PROTECTED' });
    } finally {
      await db.rollbackTx();
    }
  });
});
