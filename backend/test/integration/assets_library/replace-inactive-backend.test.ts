import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { overrideAssetSetting, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T026a — a replace writes to the asset's OWN
 * backend, whatever the active one is (FR-005; spec edge case *Switching the
 * active storage backend*; research R-1).
 */
describe('replace on a backend that is no longer the active one (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    await store.undo();
    await teardownBackendServer(h);
  });

  it('replaces a local asset in place while S3 is the active backend, never asking for the active adapter', async () => {
    const asset = await uploadAsset(h, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('local-one'),
    });
    created.push(asset.id);
    const before = await h.em().findOneOrFail(Asset, { id: asset.id });

    const restores = [
      await overrideAssetSetting(h, 'assets.storage.adapter', 's3'),
      await overrideAssetSetting(h, 'assets.s3.bucket', `${runName()}-bucket`),
      await overrideAssetSetting(h, 'assets.s3.region', 'eu-central-1'),
    ];
    h.assetsLibrary.adapters.invalidate();
    const getActive = vi.spyOn(h.assetsLibrary.adapters, 'getActive');
    try {
      const second = pdfBytes('local-two, written while S3 is active');
      const res = await replaceAsset(h, asset.id, {
        filename: `${runName()}-2.pdf`,
        mime: 'application/pdf',
        value: second,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(getActive).not.toHaveBeenCalled();

      const after = await h.em().fork().findOneOrFail(Asset, { id: asset.id });
      expect(after.storageBackend).toBe('local');
      expect(after.storageLocator).toBe(before.storageLocator);
      expect((await readFile(join(store.baseDir, after.storageLocator))).equals(second)).toBe(true);

      const served = await h.app.inject({ method: 'GET', url: `/assets/file/${asset.id}` });
      expect(served.statusCode).toBe(200);
      expect(served.rawPayload.equals(second)).toBe(true);
    } finally {
      getActive.mockRestore();
      for (const restore of restores.reverse()) await restore();
      h.assetsLibrary.adapters.invalidate();
    }
  });

  it('answers 503 ASSET_STORAGE_UNAVAILABLE for a GCS row while GCS is unconfigured, leaving the row unchanged', async () => {
    const em = h.em();
    const row = em.create(Asset, {
      kind: 'pdf',
      filename: `${runName()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '10',
      storageUrl: `https://storage.googleapis.com/unconfigured/${runName()}.pdf`,
      storageLocator: `ab/cd/${runName()}.pdf`,
      storageBackend: 'gcs',
      visibility: 'public',
    });
    await em.persist(row).flush();
    created.push(row.id);
    const restore = await overrideAssetSetting(h, 'assets.gcs.bucket', '');
    h.assetsLibrary.adapters.invalidate();
    try {
      const res = await replaceAsset(h, row.id, {
        filename: `${runName()}-2.pdf`,
        mime: 'application/pdf',
        value: pdfBytes('gcs'),
      });
      expect(res.statusCode, res.body).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('ASSET_STORAGE_UNAVAILABLE');
      const after = await h.em().fork().findOneOrFail(Asset, { id: row.id });
      expect(after.contentVersion).toBe(row.contentVersion);
      expect(after.filename).toBe(row.filename);
    } finally {
      await restore();
      h.assetsLibrary.adapters.invalidate();
    }
  });
});
