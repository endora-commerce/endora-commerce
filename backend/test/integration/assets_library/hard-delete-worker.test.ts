import { Asset } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { dirname, join } from 'node:path';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { overrideAssetSetting } from '../../helpers/crm-attachment-upload.js';

import { HardDeleteAssetWorker } from '../../../../packages/modules/assets_library/src/backend/jobs/hard-delete-asset.job.js';





/**
 * T099 — Hard-delete worker integration test.
 */

describe('hard-delete worker (T099)', () => {
  let h: BackendServerHandle;
  let baseDir: string;
  let restoreBaseDir: (() => Promise<void>) | undefined;
  let worker: HardDeleteAssetWorker;

  beforeAll(async () => {
    h = await setupBackendServer();
    baseDir = await mkdtemp(join(tmpdir(), 'assets-library-hard-delete-'));
    restoreBaseDir = await overrideAssetSetting(h, 'assets.local.base_dir', baseDir);
    h.assetsLibrary.adapters.invalidate();
    // Feature 156: the worker takes the sweep's dependencies, and due-ness is
    // `deleted_at` + the retention it is given (specs/156-asset-stable-url/ T041a).
    worker = new HardDeleteAssetWorker({
      emFactory: h.em,
      adapters: h.assetsLibrary.adapters,
      referenceRegistry: h.assetsLibrary.referenceRegistry,
      loadRetentionDays: async () => 1,
    });
  });

  afterAll(async () => {
    await restoreBaseDir?.();
    await teardownBackendServer(h);
    await rm(baseDir, { recursive: true, force: true });
  });

  it('hard-deletes a soft-deleted asset whose retention has passed, with its previous version', async () => {
    const em = h.em();
    // Forge: write a file under the local base dir, persist an Asset row
    // pointing at it, mark it soft-deleted in the past.
    const aa = 'aa';
    const bb = 'bb';
    const filename = 'aabbccdd-1111-2222-3333-444455556666.png';
    const abs = join(baseDir, aa, bb, filename);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from('hello'));
    const previousLocator = `${aa}/${bb}/aabbccdd-1111-2222-3333-444455556666.prev-${'0'.repeat(32)}.png`;
    const previousAbs = join(baseDir, previousLocator);
    await writeFile(previousAbs, Buffer.from('older'));
    const a = em.create(Asset, {
      id: 'aabbccdd-1111-2222-3333-444455556666',
      kind: 'image',
      filename,
      mimeType: 'image/png',
      sizeBytes: '5',
      storageUrl: `${aa}/${bb}/${filename}`,
      storageLocator: `${aa}/${bb}/${filename}`,
      storageBackend: 'local',
      visibility: 'public',
      // Due by `deleted_at`: two days ago against a one-day retention, while
      // `purge_after_at` still lies in the future.
      deletedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      purgeAfterAt: new Date(Date.now() + 24 * 3600 * 1000),
      previousStorageLocator: previousLocator,
      previousFilename: 'older.png',
      previousMimeType: 'image/png',
      previousMimeTypeOverridden: false,
      previousKind: 'image',
      previousSizeBytes: '5',
      previousContentVersion: 'a1b2c3d4e5f6',
      previousReplacedAt: new Date(Date.now() - 3600 * 1000),
    });
    await em.persistAndFlush(a);

    const result = await worker.sweep();
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);

    // Row should be gone and the file too.
    const fresh = h.em().fork({ clear: true });
    const after = await fresh.findOne(Asset, { id: a.id });
    expect(after).toBeNull();
    await expect(stat(abs)).rejects.toThrow();
    await expect(stat(previousAbs)).rejects.toThrow();
  });

  it('parks an asset as pendingCleanup when adapter.delete fails', async () => {
    const em = h.em();
    // The row's locator names a directory, so `unlink` fails with something
    // other than "not found" → the row remains and pendingCleanup flips to true.
    // (A file that is already gone counts as deleted since feature 156's block
    // review: the row is removed — see retention-sweep-soft-delete.test.ts.)
    await mkdir(join(baseDir, '11/22/missing-file.png'), { recursive: true });
    const a = em.create(Asset, {
      id: '11223344-5555-6666-7777-888899990000',
      kind: 'image',
      filename: 'missing.png',
      mimeType: 'image/png',
      sizeBytes: '0',
      storageUrl: '11/22/missing-file.png',
      storageLocator: '11/22/missing-file.png',
      storageBackend: 'local',
      visibility: 'public',
      deletedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      purgeAfterAt: new Date(Date.now() - 60 * 1000),
    });
    await em.persistAndFlush(a);

    const result = await worker.sweep();
    expect(result.pendingCleanup).toBeGreaterThanOrEqual(1);

    const fresh = h.em().fork({ clear: true });
    const after = await fresh.findOneOrFail(Asset, { id: a.id });
    expect(after.pendingCleanup).toBe(true);

    // Cleanup.
    await fresh.removeAndFlush(after);
  });
});
