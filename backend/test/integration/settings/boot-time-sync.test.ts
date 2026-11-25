import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { Setting } from '@endora-commerce/platform/kernel';
import { SettingValue } from '@endora-commerce/platform/kernel';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * T019 — Boot-time idempotency for the manifest reconciler.
 *
 * Spec: when a module ships a manifest, repeated applications never duplicate
 * data and never overwrite admin-chosen `setting_values`. The reconciler is
 * the function `composeApp()` calls before HTTP routes start serving (T024).
 *
 * The fixture deliberately uses a group code no shipped module owns. It used
 * to claim `sales_channels`, which only worked while the test harness happened
 * not to reconcile that module's real manifest — once it did, the fixture hit
 * GroupCodeConflict because a group belongs to exactly one owner module.
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
    });
    await em.persist(channel).flush();
    return channel;
  }

  it('seeds rows on first apply and is a no-op on a repeat apply', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);

      const catalogManifest = defineModuleSettingsManifest({
        moduleCode: 'catalog',
        groups: [{ code: 'catalog', name: 'Catalog' }],
        settings: [
          {
            code: 'catalog.base_url',
            name: 'Base URL',
            groupCode: 'catalog',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
        ],
      });

      // The fixture module's own count, not the batch total: whether the
      // `settings` manifest's rows are already there depends on which file ran
      // before this one — a file that booted a backend reconciles them, and
      // this file run alone starts without — so the total was 1 in a full run
      // and 14 alone.
      const addedBy = (result: Awaited<ReturnType<ManifestReconciler['apply']>>, code: string) =>
        result.perModule.find((m) => m.moduleCode === code)!.addedSettings;

      const r1 = await reconciler.apply([settingsManifest, catalogManifest]);
      expect(addedBy(r1, 'catalog')).toBe(1);

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
        groups: [{ code: 'catalog', name: 'Catalog' }],
        settings: [
          {
            code: 'catalog.base_url',
            name: 'Base URL',
            groupCode: 'catalog',
            valueType: 'string',
            defaultValue: 'https://default.example',
          },
        ],
      });

      await reconciler.apply([settingsManifest, catalogManifest]);

      // Admin-chosen value (simulates what US2's admin service will do).
      const setting = (await em.findOneOrFail(Setting, {
        code: 'catalog.base_url',
      })) as Setting;
      const value = em.create(SettingValue, {
        setting,
        salesChannel: channel,
        value: 'https://admin-chosen.example',
      });
      await em.persist(value).flush();

      // Re-run the reconciler. The admin override must survive.
      await reconciler.apply([settingsManifest, catalogManifest]);

      const after = await em.findOneOrFail(SettingValue, {
        setting: { code: 'catalog.base_url' },
        salesChannel: { code: 'main' },
      });
      expect(after.value).toBe('https://admin-chosen.example');
    } finally {
      await rollback();
    }
  });

  /**
   * `multiline` is manifest-driven presentation, like `hidden` and
   * `enumOptions`: the row carries what the manifest says **now**, in both
   * directions, and a manifest that never mentions the flag changes nothing.
   */
  it('keeps settings.multiline in step with the manifest, in both directions', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);

      const manifestWith = (multiline: boolean | undefined) =>
        defineModuleSettingsManifest({
          moduleCode: 'catalog',
          groups: [{ code: 'catalog', name: 'Catalog' }],
          settings: [
            {
              code: 'catalog.footer_note',
              name: 'Footer note',
              groupCode: 'catalog',
              valueType: 'string',
              defaultValue: '',
              ...(multiline === undefined ? {} : { multiline }),
            },
            {
              code: 'catalog.base_url',
              name: 'Base URL',
              groupCode: 'catalog',
              valueType: 'string',
              defaultValue: 'https://default.example',
            },
          ],
        });

      const updatedIn = (result: Awaited<ReturnType<ManifestReconciler['apply']>>): number =>
        result.perModule.find((m) => m.moduleCode === 'catalog')!.updatedSettings;

      const multilineOf = async (code: string): Promise<boolean> => {
        // Read the column itself rather than the managed entity: the claim is
        // about what a later boot, or the admin API, finds in the row.
        const rows = await em.execute<Array<{ multiline: boolean }>>(
          'select multiline from settings where code = ?',
          [code],
        );
        expect(rows).toHaveLength(1);
        return rows[0]!.multiline;
      };

      // Declared at creation.
      await reconciler.apply([settingsManifest, manifestWith(true)]);
      expect(await multilineOf('catalog.footer_note')).toBe(true);
      // A setting whose declaration never mentions the flag.
      expect(await multilineOf('catalog.base_url')).toBe(false);

      // Removed from the declaration: the next boot takes it back.
      em.clear();
      const removed = await reconciler.apply([settingsManifest, manifestWith(undefined)]);
      expect(updatedIn(removed)).toBe(1);
      expect(await multilineOf('catalog.footer_note')).toBe(false);

      // Added to a setting that already exists: the next boot sets it.
      em.clear();
      const added = await reconciler.apply([settingsManifest, manifestWith(true)]);
      expect(updatedIn(added)).toBe(1);
      expect(await multilineOf('catalog.footer_note')).toBe(true);

      // And an unchanged manifest is a no-op.
      em.clear();
      const repeat = await reconciler.apply([settingsManifest, manifestWith(true)]);
      expect(updatedIn(repeat)).toBe(0);
      expect(await multilineOf('catalog.base_url')).toBe(false);
    } finally {
      await rollback();
    }
  });

  /**
   * The state an upgrade passes through, or is left in when a migration was
   * not delivered: this release's code over a `settings` table that has no
   * `multiline` column yet. A row read from it carries no such property, and
   * "absent" is not "different from false" — so re-applying manifests that
   * never mention the flag must not try to write a column that is not there.
   * A manifest that **does** declare it has asked for something this database
   * cannot store, and that one is refused loudly rather than dropped.
   *
   * The column is dropped inside the test transaction and comes back with the
   * rollback.
   */
  it('re-applies over a table without the multiline column, until a manifest sets the flag', async () => {
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      const manifestWith = (multiline: boolean) =>
        defineModuleSettingsManifest({
          moduleCode: 'catalog',
          groups: [{ code: 'catalog', name: 'Catalog' }],
          settings: [
            {
              code: 'catalog.footer_note',
              name: 'Footer note',
              groupCode: 'catalog',
              valueType: 'string',
              defaultValue: '',
              ...(multiline ? { multiline } : {}),
            },
          ],
        });

      await reconciler.apply([settingsManifest, manifestWith(false)]);
      await em.execute('alter table settings drop column multiline');
      em.clear();

      const repeat = await reconciler.apply([settingsManifest, manifestWith(false)]);
      expect(repeat.perModule.map((m) => m.updatedSettings)).toEqual([0, 0]);

      em.clear();
      await expect(reconciler.apply([settingsManifest, manifestWith(true)])).rejects.toThrow(
        /multiline/,
      );
    } finally {
      await rollback();
    }
  });

  it('leaves every setting a shipped manifest declares single-line', async () => {
    try {
      const em = db.em();
      await new ManifestReconciler(em).apply([settingsManifest]);
      const rows = await em.execute<Array<{ total: string; multiline: string }>>(
        `select count(*)::text as total,
                count(*) filter (where multiline)::text as multiline
         from settings where owner_module = 'settings'`,
      );
      // Non-vacuous: the manifest's rows are there, and none asks for the field.
      expect(Number(rows[0]!.total)).toBe(settingsManifest.settings.length);
      expect(rows[0]!.multiline).toBe('0');
    } finally {
      await rollback();
    }
  });
});
