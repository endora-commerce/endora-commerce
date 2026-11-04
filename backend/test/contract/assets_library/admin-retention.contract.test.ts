import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { Asset, AssetFolder } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const adminCookie = { b2b_session: 'stub-admin-session' };

/** Real routes and reloaded PostgreSQL rows must agree on the configured deadline. */
describe('asset retention setting (#322)', () => {
  let h: BackendServerHandle;
  const assetIds: string[] = [];
  const folderIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterEach(async () => {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'assets.soft_delete_retention_days' });
    setting.globalValue = null;
    const overrides = await em.find(SettingValue, { setting });
    em.remove(overrides);
    if (assetIds.length) em.remove(await em.find(Asset, { id: { $in: assetIds } }));
    await em.flush();
    await h.settings.cache.invalidate('assets.soft_delete_retention_days');
    // Children first; recursive deletion normally already removed these rows.
    for (const id of folderIds.reverse()) {
      const folder = await em.findOne(AssetFolder, { id });
      if (folder) await em.removeAndFlush(folder);
    }
    assetIds.length = 0;
    folderIds.length = 0;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function setRetention(days: number | undefined) {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'assets.soft_delete_retention_days' });
    em.remove(await em.find(SettingValue, { setting }));
    await em.flush();
    // The Admin Settings screen stores its all-channels override here.
    setting.globalValue = days ?? null;
    await em.flush();
    // The platform read is cached; the admin write drops the entry, and so must this.
    await h.settings.cache.invalidate('assets.soft_delete_retention_days');
  }

  async function createAsset(folderId: string | null = null) {
    const em = h.em();
    const asset = em.create(Asset, {
      kind: 'image', filename: 'retention.png', mimeType: 'image/png', sizeBytes: '0',
      storageUrl: 'https://example.test/retention.png',
      storageLocator: 'https://example.test/retention.png',
      storageBackend: 'legacy', visibility: 'public', folderId,
    });
    await em.persistAndFlush(asset);
    assetIds.push(asset.id);
    return asset;
  }

  async function createFolder(parentId: string | null) {
    const em = h.em();
    const folder = em.create(AssetFolder, { name: `retention-${folderIds.length}`, parentId });
    await em.persistAndFlush(folder);
    folderIds.push(folder.id);
    return folder;
  }

  it.each([7, 90, 0, undefined])('single delete uses %s days (undefined uses default 30)', async (days) => {
    await setRetention(days);
    const asset = await createAsset();
    const reply = await h.app.inject({
      method: 'DELETE', url: `/api/v1/admin/assets/${asset.id}`, cookies: adminCookie,
    });
    expect(reply.statusCode).toBe(200);
    const { data } = reply.json<{ data: { deletedAt: string; purgeAfterAt: string } }>();
    expect(Date.parse(data.purgeAfterAt) - Date.parse(data.deletedAt)).toBe(Math.max(1, days ?? 30) * DAY_MS);
    const stored = await h.em().fork({ clear: true }).findOneOrFail(Asset, { id: asset.id });
    expect(stored.purgeAfterAt?.toISOString()).toBe(data.purgeAfterAt);

    // Feature 156 (owner ruling P1): a later setting change applies to an
    // existing deletion — the repeated answer reports `deletedAt` + the current
    // setting, which is what the sweep will use — while the stored
    // `purge_after_at` keeps the first value as a rollback snapshot.
    await setRetention(14);
    const again = await h.app.inject({
      method: 'DELETE', url: `/api/v1/admin/assets/${asset.id}`, cookies: adminCookie,
    });
    expect(again.statusCode).toBe(200);
    const repeated = again.json<{ data: { deletedAt: string; purgeAfterAt: string } }>().data;
    expect(repeated.deletedAt).toBe(data.deletedAt);
    expect(Date.parse(repeated.purgeAfterAt) - Date.parse(repeated.deletedAt)).toBe(14 * DAY_MS);
    const kept = await h.em().fork({ clear: true }).findOneOrFail(Asset, { id: asset.id });
    expect(kept.purgeAfterAt?.toISOString()).toBe(data.purgeAfterAt);
  });

  it.each([7, 90, 0, undefined])('recursive delete uses %s days throughout the subtree', async (days) => {
    await setRetention(days);
    const root = await createFolder(null);
    const child = await createFolder(root.id);
    const direct = await createAsset(root.id);
    const nested = await createAsset(child.id);
    const reply = await h.app.inject({
      method: 'DELETE', url: `/api/v1/admin/assets/folders/${root.id}`, cookies: adminCookie,
      payload: { ifNonEmpty: 'deleteRecursively' },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json<{ data: { softDeletedAssetIds: string[] } }>().data.softDeletedAssetIds.sort())
      .toEqual([direct.id, nested.id].sort());
    const fresh = h.em().fork({ clear: true });
    for (const id of [direct.id, nested.id]) {
      const stored = await fresh.findOneOrFail(Asset, { id });
      expect(stored.deletedAt).toBeInstanceOf(Date);
      expect(stored.purgeAfterAt!.getTime() - stored.deletedAt!.getTime()).toBe(Math.max(1, days ?? 30) * DAY_MS);
    }
  });
});
