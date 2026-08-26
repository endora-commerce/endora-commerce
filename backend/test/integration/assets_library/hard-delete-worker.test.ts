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

import { HardDeleteAssetWorker } from '../../../../packages/modules/assets_library/src/backend/jobs/hard-delete-asset.job.js';

import { Setting } from '../../../src/kernel/settings/setting.entity.js';

import { SettingValue } from '../../../src/kernel/settings/setting-value.entity.js';

import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';


/**
 * T099 — Hard-delete worker integration test.
 */

describe('hard-delete worker (T099)', () => {
  let h: BackendServerHandle;
  let baseDir: string;
  let worker: HardDeleteAssetWorker;

  beforeAll(async () => {
    h = await setupBackendServer();
    baseDir = await mkdtemp(join(tmpdir(), 'assets-library-hard-delete-'));
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'assets.local.base_dir' });
    const channel = await em.findOneOrFail(SalesChannel, { code: 'default' });
    const existing = await em.findOne(SettingValue, { setting });
    if (existing) existing.value = baseDir;
    else em.create(SettingValue, { setting, salesChannel: channel, value: baseDir });
    await em.flush();
    h.assetsLibrary.adapters.invalidate();
    worker = new HardDeleteAssetWorker(h.em, h.assetsLibrary.adapters);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    await rm(baseDir, { recursive: true, force: true });
  });

  it('hard-deletes a soft-deleted asset whose purge time has passed', async () => {
    const em = h.em();
    // Forge: write a file under the local base dir, persist an Asset row
    // pointing at it, mark it soft-deleted in the past.
    const aa = 'aa';
    const bb = 'bb';
    const filename = 'aabbccdd-1111-2222-3333-444455556666.png';
    const abs = join(baseDir, aa, bb, filename);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, Buffer.from('hello'));
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
      deletedAt: new Date(Date.now() - 3600 * 1000),
      purgeAfterAt: new Date(Date.now() - 60 * 1000),
    });
    await em.persistAndFlush(a);

    const result = await worker.sweep();
    expect(result.hardDeleted).toBeGreaterThanOrEqual(1);

    // Row should be gone and the file too.
    const fresh = h.em().fork({ clear: true });
    const after = await fresh.findOne(Asset, { id: a.id });
    expect(after).toBeNull();
    await expect(stat(abs)).rejects.toThrow();
  });

  it('parks an asset as pendingCleanup when adapter.delete fails', async () => {
    const em = h.em();
    // Asset row points at a missing file → adapter.delete throws → row
    // remains, pendingCleanup flips to true.
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
      deletedAt: new Date(Date.now() - 3600 * 1000),
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
