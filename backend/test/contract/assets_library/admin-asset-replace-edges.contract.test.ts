import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  TINY_JPEG,
  TINY_PNG,
  TINY_SVG,
  cleanupEntriesOf,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
  type AssetBody,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` QA of the backend block — the replace edge
 * cases FR-006 and FR-013 name that the T026 file does not reach over HTTP: a
 * private asset, the admin's MIME override, and an SVG offered for a PDF.
 */

interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

describe('POST /api/v1/admin/assets/:id/replace — edge cases (feature 156 QA)', () => {
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

  async function upload(filename: string, mime: string, value: Buffer, fields: Record<string, string> = {}) {
    const asset = await uploadAsset(h, { filename, mime, value }, fields);
    created.push(asset.id);
    return asset;
  }

  const get = (url: string) => h.app.inject({ method: 'GET', url });

  async function signedQuery(id: string): Promise<string> {
    const r = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}/url`, cookies: ADMIN });
    return new URL((r.json() as { data: { url: string } }).data.url).search;
  }

  it('replaces a private asset in place: it stays private, unsigned requests stay refused, a signature serves the new bytes', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('private-1'), {
      visibility: 'private',
    });
    expect(asset.visibility).toBe('private');
    const bytes = pdfBytes('private-2');
    const res = await replaceAsset(h, asset.id, { filename: `${runName()}.pdf`, mime: 'application/pdf', value: bytes });
    expect(res.statusCode, res.body).toBe(200);
    const after = (res.json() as { data: AssetBody }).data;
    expect(after.id).toBe(asset.id);
    expect(after.visibility).toBe('private');
    expect(after.contentVersion).not.toBe(asset.contentVersion);

    const unsigned = await get(`/assets/file/${asset.id}`);
    expect(unsigned.statusCode).toBe(404);
    expect(unsigned.json()).toMatchObject({ error: { code: 'ASSET_NOT_FOUND' } });
    const unsignedVersioned = await get(`/assets/file/${asset.id}?v=${after.contentVersion}`);
    expect(unsignedVersioned.statusCode).toBe(404);

    const signed = await get(`/assets/file/${asset.id}${await signedQuery(asset.id)}`);
    expect(signed.statusCode).toBe(200);
    expect(signed.rawPayload.equals(bytes)).toBe(true);
    expect(signed.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(await cleanupEntriesOf(h, asset.id)).toEqual([]);
  });

  it('judges an image by its stored kind, whatever MIME an admin set on it', async () => {
    const asset = await upload(`${runName()}.png`, 'image/png', TINY_PNG);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/assets/${asset.id}`,
      cookies: ADMIN,
      payload: { mimeType: 'application/pdf' },
    });
    expect(patch.statusCode, patch.body).toBe(200);

    // A PDF is refused although the override says the asset is one …
    const pdf = await replaceAsset(h, asset.id, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('override'),
    });
    expect(pdf.statusCode, pdf.body).toBe(415);
    const body = pdf.json() as ErrorBody;
    expect(body.error.code).toBe('ASSET_REPLACE_KIND_MISMATCH');
    expect(body.error.details).toMatchObject({ currentKind: 'image', newKind: 'pdf' });

    // … and an image is accepted although it does not match the override.
    const jpeg = await replaceAsset(h, asset.id, {
      filename: `${runName()}.jpg`,
      mime: 'image/jpeg',
      value: TINY_JPEG,
    });
    expect(jpeg.statusCode, jpeg.body).toBe(200);
    expect((jpeg.json() as { data: AssetBody }).data.mimeType).toBe('image/jpeg');
  });

  it('counts an SVG as an image: it cannot replace a PDF', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('svg-for-pdf'));
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.svg`,
      mime: 'image/svg+xml',
      value: TINY_SVG,
    });
    expect(res.statusCode, res.body).toBe(415);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe('ASSET_REPLACE_KIND_MISMATCH');
    expect(body.error.details).toMatchObject({ currentKind: 'pdf', newKind: 'image' });
    expect(await cleanupEntriesOf(h, asset.id)).toEqual([]);
  });

  it('does not let a client-declared image type turn unrecognised bytes into an image, and changes nothing', async () => {
    const asset = await upload(`${runName()}.svg`, 'image/svg+xml', TINY_SVG);
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.png`,
      mime: 'image/png',
      value: Buffer.from('plain text, not a picture'),
    });
    expect(res.statusCode, res.body).toBe(415);
    expect((res.json() as ErrorBody).error.details).toMatchObject({ currentKind: 'image', newKind: 'other' });
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${asset.id}`, cookies: ADMIN });
    expect((detail.json() as { data: AssetBody }).data.contentVersion).toBe(asset.contentVersion);
  });
});
