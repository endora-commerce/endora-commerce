import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { overrideAssetSetting } from '../../helpers/crm-attachment-upload.js';
import { forgetAssets, runName } from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T057 — the file route for S3 rows: a `no-store`
 * redirect to the stable bucket URL when public, and no `Location` at all for a
 * private row requested without a signature (R-11, FR-018, SC-004). Rows are
 * forged; nothing reaches the network.
 */
describe('the file route for cloud assets (feature 156)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];
  const restores: Array<() => Promise<void>> = [];
  const bucket = `${runName()}-bucket`;
  const region = 'eu-central-1';

  beforeAll(async () => {
    h = await setupBackendServer();
    restores.push(await overrideAssetSetting(h, 'assets.s3.bucket', bucket));
    restores.push(await overrideAssetSetting(h, 'assets.s3.region', region));
    h.assetsLibrary.adapters.invalidate();
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    for (const restore of restores.reverse()) await restore();
    h.assetsLibrary.adapters.invalidate();
    await teardownBackendServer(h);
  });

  async function forge(visibility: 'public' | 'private') {
    const id = randomUUID();
    const key = `as156/${id.slice(0, 2)}/${id}.pdf`;
    const permalink = `${runName()}/cloud-${visibility}.pdf`;
    const em = h.em();
    em.create(Asset, {
      id,
      kind: 'pdf',
      filename: `${runName()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '10',
      storageUrl: `https://${bucket}.s3.${region}.amazonaws.com/${key}`,
      storageLocator: key,
      storageBackend: 's3',
      visibility,
      permalink,
    });
    await em.flush();
    created.push(id);
    const row = await h.em().fork().findOneOrFail(Asset, { id });
    return { id, key, permalink, contentVersion: row.contentVersion };
  }

  it('redirects a public S3 asset to its stable bucket URL with no-store, adding the current marker when one was asked for', async () => {
    const a = await forge('public');
    const stable = `https://${bucket}.s3.${region}.amazonaws.com/${a.key}`;
    const bare = await h.app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(bare.statusCode).toBe(302);
    expect(bare.headers['location']).toBe(stable);
    expect(bare.headers['cache-control']).toBe('no-store');
    const marked = await h.app.inject({ method: 'GET', url: `/assets/file/${a.id}?v=anything` });
    expect(marked.headers['location']).toBe(`${stable}?v=${a.contentVersion}`);
  });

  it('refuses a private S3 asset without a signature — 404 by id and by permalink — with no Location', async () => {
    const a = await forge('private');
    const byId = await h.app.inject({ method: 'GET', url: `/assets/file/${a.id}` });
    expect(byId.statusCode).toBe(404);
    expect(byId.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
    expect(byId.headers['location']).toBeUndefined();
    const byName = await h.app.inject({ method: 'GET', url: `/assets/file/${a.permalink}` });
    expect(byName.statusCode).toBe(404);
    expect(byName.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
    expect(byName.headers['location']).toBeUndefined();
  });
});
