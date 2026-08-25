import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { settingsManifest } from '../../../../packages/modules/settings/src/manifest.js';
import { assetsLibraryManifest } from '../../../../packages/modules/assets_library/src/manifest.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { SettingGroup } from '../../../src/kernel/settings/setting-group.entity.js';

/**
 * T026 — Settings manifest reconciliation for the Assets Library.
 *
 * Validates that running the reconciler with the assets_library manifest
 * creates the `storage` group and one row per declared setting code with
 * the manifest's defaultValue. Repeated runs are idempotent.
 */
describe('assets_library settings manifest (T026)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the `storage` group and every assets.* setting on first apply', async () => {
    await db.beginTx();
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      // Settings module's own manifest seeds the `general` group; assets_library
      // requires only that — no other module manifest needed for this test.
      await reconciler.apply([settingsManifest, assetsLibraryManifest]);

      const storage = await em.findOne(SettingGroup, { code: 'storage' });
      expect(storage).not.toBeNull();
      expect(storage!.ownerModule).toBe('assets_library');

      const settings = await em.find(
        Setting,
        { ownerModule: 'assets_library' },
        { orderBy: { code: 'asc' } },
      );
      const codes = settings.map((s) => s.code).sort();
      expect(codes).toContain('assets.storage.adapter');
      expect(codes).toContain('assets.local.base_dir');
      expect(codes).toContain('assets.s3.bucket');
      expect(codes).toContain('assets.gcs.bucket');
      expect(codes).toContain('assets.allowed_file_types');
      expect(codes).toContain('assets.max_file_size_mb');
      expect(codes).toContain('assets.private_url_ttl_sec');
      expect(codes).toContain('assets.soft_delete_retention_days');

      const adapter = settings.find((s) => s.code === 'assets.storage.adapter');
      expect(adapter?.defaultValue).toBe('local');
      const allowedTypes = settings.find((s) => s.code === 'assets.allowed_file_types');
      expect(allowedTypes?.defaultValue).toEqual(['*']);
      const maxSize = settings.find((s) => s.code === 'assets.max_file_size_mb');
      expect(maxSize?.defaultValue).toBe(0);
    } finally {
      await db.rollbackTx();
    }
  });

  it('is idempotent — second apply does not duplicate rows', async () => {
    await db.beginTx();
    try {
      const em = db.em();
      const reconciler = new ManifestReconciler(em);
      await reconciler.apply([settingsManifest, assetsLibraryManifest]);
      const before = await em.count(Setting, { ownerModule: 'assets_library' });
      await reconciler.apply([settingsManifest, assetsLibraryManifest]);
      const after = await em.count(Setting, { ownerModule: 'assets_library' });
      expect(after).toBe(before);
    } finally {
      await db.rollbackTx();
    }
  });
});
