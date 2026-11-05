import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { access, mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { overrideAssetSetting, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  forgetAssets,
  pdfBytes,
  runName,
  testRetentionSweeper,
  uploadAsset,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T041a — the soft-delete passes of the retention
 * sweep (contracts/storage-and-retention.md §4 passes 2 and 3; User Story 4,
 * FR-029 – FR-035, SC-007, owner rulings P1 and P3).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe('retention sweep — soft-deleted assets (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  let restoreRetention: () => Promise<void>;
  const created: string[] = [];
  const products: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    restoreRetention = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', 10);
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await forgetAssets(h, created);
    for (const productId of products) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${productId}`, cookies: ADMIN });
    }
    await restoreRetention();
    await store.undo();
    await teardownBackendServer(h);
  });

  async function withRetention<T>(days: number, body: () => Promise<T>): Promise<T> {
    const restore = await overrideAssetSetting(h, 'assets.soft_delete_retention_days', days);
    try {
      return await body();
    } finally {
      await restore();
    }
  }

  async function writeObject(locator: string): Promise<string> {
    const abs = join(store.baseDir, locator);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, locator);
    return abs;
  }

  async function exists(abs: string): Promise<boolean> {
    try {
      await access(abs);
      return true;
    } catch {
      return false;
    }
  }

  /** A soft-deleted asset with real files, deleted `deletedAgoMs` before `now`. */
  async function forgeDeleted(now: Date, deletedAgoMs: number, options: { previous?: boolean } = {}) {
    const id = randomUUID();
    const stable = `as156/${id.slice(0, 2)}/${id}.pdf`;
    const previous = `as156/${id.slice(0, 2)}/${id}.prev-${randomUUID().replace(/-/g, '')}.pdf`;
    const stableAbs = await writeObject(stable);
    const previousAbs = options.previous ? await writeObject(previous) : null;
    const deletedAt = new Date(now.getTime() - deletedAgoMs);
    const em = h.em();
    em.create(Asset, {
      id,
      kind: 'pdf',
      filename: `as156-${id.slice(0, 8)}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '7',
      storageUrl: `/assets/file/${id}`,
      storageLocator: stable,
      storageBackend: 'local',
      visibility: 'public',
      deletedAt,
      // Far in the future on purpose: the sweep counts from `deleted_at`.
      purgeAfterAt: new Date(now.getTime() + 365 * DAY_MS),
      ...(options.previous
        ? {
            previousStorageLocator: previous,
            previousFilename: 'old.pdf',
            previousMimeType: 'application/pdf',
            previousMimeTypeOverridden: false,
            previousKind: 'pdf' as const,
            previousSizeBytes: '3',
            previousContentVersion: 'a1b2c3d4e5f6',
            previousReplacedAt: new Date(now.getTime() - HOUR_MS),
          }
        : {}),
    });
    await em.flush();
    created.push(id);
    return { id, stable, stableAbs, previousAbs };
  }

  async function gone(id: string): Promise<boolean> {
    return (await h.em().fork().findOne(Asset, { id })) === null;
  }

  function failDeletesOf(locator: string): void {
    const adapters = h.assetsLibrary.adapters;
    const real = adapters.getForBackend.bind(adapters);
    vi.spyOn(adapters, 'getForBackend').mockImplementation((async (code: 'local') => {
      const adapter = await real(code);
      return new Proxy(adapter, {
        get(target, prop, receiver) {
          if (prop === 'delete') {
            return async (input: { locator: string }) => {
              if (input.locator === locator) throw new Error('simulated delete failure');
              return (target as { delete: (i: unknown) => Promise<void> }).delete(input);
            };
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
    }) as never);
  }

  it('purges the oldest due rows first, at most one batch per pass, and counts what is left', async () => {
    const now = new Date();
    const oldest = await forgeDeleted(now, 400 * DAY_MS);
    const second = await forgeDeleted(now, 399 * DAY_MS);
    const third = await forgeDeleted(now, 398 * DAY_MS);
    const lines: Array<Record<string, unknown>> = [];
    const sweeper = testRetentionSweeper(h, {
      batchSize: 2,
      log: { info: (obj: Record<string, unknown>) => void lines.push(obj) } as never,
    });

    const first = await sweeper.sweep(now);
    expect(await gone(oldest.id)).toBe(true);
    expect(await gone(second.id)).toBe(true);
    expect(await gone(third.id)).toBe(false);
    expect(first.hardDeleted).toBeLessThanOrEqual(2);
    expect(first.dueRemaining).toBeGreaterThanOrEqual(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: 'assets_library.retention.sweep',
      retentionDays: 10,
      hardDeleted: first.hardDeleted,
      pendingCleanup: first.pendingCleanup,
      previousPurged: first.previousPurged,
      dueRemaining: first.dueRemaining,
    });

    await sweeper.sweep(now);
    expect(await gone(third.id)).toBe(true);
    expect(lines).toHaveLength(2);
  });

  it('bounds the previous-version pass by its own batch and counts it separately', async () => {
    const now = new Date();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = randomUUID();
      const em = h.em();
      em.create(Asset, {
        id,
        kind: 'pdf',
        filename: `${runName()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: '1',
        storageUrl: `/assets/file/${id}`,
        storageLocator: `as156/${id}.pdf`,
        storageBackend: 'local',
        visibility: 'public',
        previousStorageLocator: `as156/${id}.prev-${'0'.repeat(32)}.pdf`,
        previousFilename: 'old.pdf',
        previousMimeType: 'application/pdf',
        previousMimeTypeOverridden: false,
        previousKind: 'pdf',
        previousSizeBytes: '1',
        previousContentVersion: 'a1b2c3d4e5f6',
        previousReplacedAt: new Date(now.getTime() - (500 + i) * DAY_MS),
      });
      await em.flush();
      created.push(id);
      ids.push(id);
    }
    const result = await testRetentionSweeper(h, { batchSize: 2 }).sweep(now);
    expect(result.previousPurged).toBe(2);
    const remaining = await h.em().fork().count(Asset, { id: { $in: ids }, previousStorageLocator: { $ne: null } });
    expect(remaining).toBe(1);
  });

  it('hard-deletes a due soft-deleted asset with its stable and previous files, whatever purge_after_at says, and keeps a younger one', async () => {
    const now = new Date();
    const due = await forgeDeleted(now, 20 * DAY_MS, { previous: true });
    const young = await forgeDeleted(now, 5 * DAY_MS);
    const result = await h.assetsLibrary.sweeper.sweep(now);
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);
    expect(await gone(due.id)).toBe(true);
    expect(await exists(due.stableAbs)).toBe(false);
    expect(await exists(due.previousAbs!)).toBe(false);
    expect(await gone(young.id)).toBe(false);
    expect(await exists(young.stableAbs)).toBe(true);
  });

  it('applies a shortened setting to assets already soft-deleted (P1)', async () => {
    const now = new Date();
    const asset = await forgeDeleted(now, 5 * DAY_MS);
    await h.assetsLibrary.sweeper.sweep(now);
    expect(await gone(asset.id)).toBe(false);
    await withRetention(3, () => h.assetsLibrary.sweeper.sweep(now));
    expect(await gone(asset.id)).toBe(true);
  });

  it('holds a zero setting to one day (P3)', async () => {
    const now = new Date();
    const recent = await forgeDeleted(now, 12 * HOUR_MS);
    const older = await forgeDeleted(now, 25 * HOUR_MS);
    await withRetention(0, () => h.assetsLibrary.sweeper.sweep(now));
    expect(await gone(recent.id)).toBe(false);
    expect(await gone(older.id)).toBe(true);
  });

  it('purges assets soft-deleted through a recursive folder delete on the same rule', async () => {
    const folder = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets/folders',
      cookies: ADMIN,
      payload: { name: runName(), parentId: null },
    });
    expect(folder.statusCode, folder.body).toBe(201);
    const folderId = (folder.json() as { data: { id: string } }).data.id;
    const asset = await uploadAsset(
      h,
      { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('folder') },
      { folderId },
    );
    created.push(asset.id);
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/assets/folders/${folderId}`,
      cookies: ADMIN,
      payload: { ifNonEmpty: 'deleteRecursively' },
    });
    expect(del.statusCode, del.body).toBe(200);

    await withRetention(2, async () => {
      await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 1 * DAY_MS));
      expect(await gone(asset.id)).toBe(false);
      await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 2 * DAY_MS + HOUR_MS));
      expect(await gone(asset.id)).toBe(true);
    });
  });

  it('skips a referenced asset, which stays soft-deleted', async () => {
    const asset = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('ref') });
    created.push(asset.id);
    const product = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `${runName()}-SKU`,
        type: 'simple',
        name: 'Retention fixture',
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(product.statusCode, product.body).toBe(201);
    const productId = (product.json() as { data: { id: string } }).data.id;
    products.push(productId);
    const types = await h.app.inject({ method: 'GET', url: '/api/v1/admin/catalog/attachment-types', cookies: ADMIN });
    const pdfType = (types.json() as { data: Array<{ id: string; code: string }> }).data.find((t) => t.code === 'pdf');
    const attach = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      cookies: ADMIN,
      payload: { assetId: asset.id, attachmentTypeId: pdfType!.id, name: 'Certificate', description: '' },
    });
    expect(attach.statusCode, attach.body).toBe(201);
    const now = new Date();
    await h
      .em()
      .getConnection()
      .execute(`update assets set deleted_at = ? where id = ?`, [new Date(now.getTime() - 20 * DAY_MS), asset.id]);

    const result = await h.assetsLibrary.sweeper.sweep(now);
    expect(result.skippedReferenced).toBeGreaterThanOrEqual(1);
    const row = await h.em().fork().findOneOrFail(Asset, { id: asset.id });
    expect(row.deletedAt).not.toBeNull();
  });

  it('parks an asset whose stable delete fails, purges the others, and purges it on a later sweep', async () => {
    const now = new Date();
    const failing = await forgeDeleted(now, 20 * DAY_MS);
    const other = await forgeDeleted(now, 20 * DAY_MS);
    failDeletesOf(failing.stable);
    await h.assetsLibrary.sweeper.sweep(now);
    expect(await gone(other.id)).toBe(true);
    const parked = await h.em().fork().findOneOrFail(Asset, { id: failing.id });
    expect(parked.pendingCleanup).toBe(true);
    expect(parked.deletedAt).not.toBeNull();

    vi.restoreAllMocks();
    await h.assetsLibrary.sweeper.sweep(now);
    expect(await gone(failing.id)).toBe(true);
    expect(await exists(failing.stableAbs)).toBe(false);
  });

  it('leaves a restored asset alone, and counts a second deletion from its own date', async () => {
    const asset = await uploadAsset(h, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('restored') });
    created.push(asset.id);
    await withRetention(2, async () => {
      const first = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${asset.id}`, cookies: ADMIN });
      expect(first.statusCode, first.body).toBe(200);
      const restored = await h.app.inject({ method: 'POST', url: `/api/v1/admin/assets/${asset.id}/restore`, cookies: ADMIN });
      expect(restored.statusCode, restored.body).toBe(200);
      await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 3 * DAY_MS));
      expect(await gone(asset.id)).toBe(false);

      // Deleted again, a full period counts from the new deletion.
      const again = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${asset.id}`, cookies: ADMIN });
      expect(again.statusCode, again.body).toBe(200);
      await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 2 * DAY_MS - HOUR_MS));
      expect(await gone(asset.id)).toBe(false);
      await h.assetsLibrary.sweeper.sweep(new Date(Date.now() + 2 * DAY_MS + HOUR_MS));
      expect(await gone(asset.id)).toBe(true);
    });
  });

  // Block review A — a row on a backend this deployment cannot reach is parked,
  // and the rest of the batch still runs (FR-032).
  it('parks a due row on an unconfigured cloud backend and still purges the local one after it', async () => {
    const now = new Date();
    const id = randomUUID();
    const em = h.em();
    em.create(Asset, {
      id,
      kind: 'pdf',
      filename: `${runName()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '1',
      storageUrl: `https://storage.googleapis.com/unconfigured/${id}.pdf`,
      storageLocator: `as156/${id}.pdf`,
      storageBackend: 'gcs',
      visibility: 'public',
      deletedAt: new Date(now.getTime() - 30 * DAY_MS),
    });
    await em.flush();
    created.push(id);
    const local = await forgeDeleted(now, 20 * DAY_MS);
    const restore = await overrideAssetSetting(h, 'assets.gcs.bucket', '');
    h.assetsLibrary.adapters.invalidate();
    try {
      await h.assetsLibrary.sweeper.sweep(now);
    } finally {
      await restore();
      h.assetsLibrary.adapters.invalidate();
    }
    expect(await gone(local.id)).toBe(true);
    const parked = await h.em().fork().findOneOrFail(Asset, { id });
    expect(parked.pendingCleanup).toBe(true);
    expect(parked.deletedAt).not.toBeNull();
  });

  // Block review B — an object already gone counts as deleted: the row goes and
  // its permalink is released, instead of being parked for ever.
  it('removes a due row whose stable file is already gone, releasing its permalink', async () => {
    const now = new Date();
    const asset = await forgeDeleted(now, 20 * DAY_MS);
    const permalink = `${runName()}/gone.pdf`;
    await h.em().getConnection().execute('update assets set permalink = ? where id = ?', [permalink, asset.id]);
    await unlink(asset.stableAbs);
    await h.assetsLibrary.sweeper.sweep(now);
    expect(await gone(asset.id)).toBe(true);
    const releases = await h
      .em()
      .getConnection()
      .execute<Array<{ reason: string }>>('select reason from asset_permalink_releases where permalink_lower = ?', [
        permalink.toLowerCase(),
      ]);
    expect(releases).toEqual([{ reason: 'purged' }]);
    await h.em().getConnection().execute('delete from asset_permalink_releases where permalink_lower = ?', [permalink.toLowerCase()]);
  });
});
