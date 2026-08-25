import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { salesChannelsManifest } from '../../../../packages/modules/sales_channels/src/manifest.js';
import { settingsManifest } from '../../../src/modules/settings/manifest.js';
import { SettingGroup } from '../../../src/kernel/settings/setting-group.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';

/**
 * T069 — `b2b modules install sales_channels` is idempotent.
 *
 * The CLI invokes the same `ManifestReconciler` that boot-time sync
 * uses; running it twice must produce identical state and not bump
 * the audit log on the second run beyond the bookkeeping the manifest
 * reconciler emits for itself (which is "added: 0, updated: 0").
 *
 * The sales_channels manifest registers exactly one group
 * (`sales_channels`) and zero settings. Re-applying it is the
 * smallest possible exercise of the manifest pipeline; the same
 * guarantees hold for any other module that ships a manifest later.
 */
describe('modules:install sales_channels — idempotency (T069)', () => {
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

  it('first apply inserts the sales_channels group; second is a no-op', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);

      // Settings module's `general` group must exist before any other module
      // applies — that's the whole reason the settings manifest reconciles
      // first in composition.ts. Mirror it here.
      await reconciler.apply([settingsManifest]);

      const before = await em.find(SettingGroup, { code: 'sales_channels' });
      const beforeSettings = await em.find(Setting, { ownerModule: 'sales_channels' });
      // First apply.
      const first = await reconciler.apply([salesChannelsManifest]);
      const firstModule = first.perModule.find((m) => m.moduleCode === 'sales_channels');
      expect(firstModule).toBeDefined();
      // The group + the module's single `storefront_url` setting are either
      // added now (when not pre-existing) or already present (when a previous
      // test left them).
      if (before.length === 0) {
        expect(firstModule!.addedGroups).toBe(1);
      }
      if (beforeSettings.length === 0) {
        expect(firstModule!.addedSettings).toBe(1);
      }

      const sales = await em.findOneOrFail(SettingGroup, { code: 'sales_channels' });
      expect(sales.ownerModule).toBe('sales_channels');

      // Second apply is a strict no-op for both groups and settings.
      const second = await reconciler.apply([salesChannelsManifest]);
      const secondModule = second.perModule.find((m) => m.moduleCode === 'sales_channels');
      expect(secondModule).toBeDefined();
      expect(secondModule!.addedGroups).toBe(0);
      expect(secondModule!.addedSettings).toBe(0);

      // Group still exactly one row.
      const all = await em.find(SettingGroup, { code: 'sales_channels' });
      expect(all.length).toBe(1);

      // The sales_channels manifest ships exactly one setting, the storefront
      // URL, so confirm the pipeline persists that row and synthesizes no
      // phantom ones under owner_module='sales_channels'. It shipped a second
      // until feature 074: `sales_channels.enabled` was the operator's
      // activation control, and the module is core now — channel scoping is
      // structural, so there is no unscoped path to fall back to and the
      // control went with the declaration.
      const owned = await em.find(Setting, { ownerModule: 'sales_channels' });
      expect(owned.map((s) => s.code).sort()).toEqual(['sales_channels.storefront_url']);
    } finally {
      await db.rollbackTx();
    }
  });
});
