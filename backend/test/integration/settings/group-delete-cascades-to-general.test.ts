import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { SettingsAdminService } from '../../../../packages/modules/settings/src/backend/services/settings-admin.service.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { EventBus } from '../../../src/events/bus.js';
import type { SettingsCacheInvalidation } from '../../../src/kernel/settings/settings-cache.js';

/**
 * T033 — Group deletion reassigns owned settings to `general` and preserves
 * their per-channel values byte-for-byte.
 */

/**
 * This file's harness is a bare transactional `TestDb` with no Redis, and every
 * assertion below is about rows. The write seam still drops the cache (issue
 * #45), so the service needs one to call — a counting stand-in, not a mock of
 * behaviour under test.
 */
const noCache: SettingsCacheInvalidation = {
  invalidateAfterWrite: async () => 0,
  invalidateAllAfterWrite: async () => 0,
};

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
      const adminService = new SettingsAdminService(() => db.em(), new EventBus(), noCache);
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
      const adminService = new SettingsAdminService(() => db.em(), new EventBus(), noCache);
      await expect(
        adminService.deleteGroup('general', { actorAdminUserId: null }),
      ).rejects.toMatchObject({ code: 'SETTING_GROUP_PROTECTED' });
    } finally {
      await db.rollbackTx();
    }
  });
});
