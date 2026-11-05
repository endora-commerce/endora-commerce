import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Asset } from '../../helpers/package-entities.js';
import { multipartBody, overrideAssetSetting, useTemporaryAssetStore } from '../../helpers/crm-attachment-upload.js';
import {
  ADMIN,
  DOCX_MIME,
  TINY_JPEG,
  TINY_PNG,
  TINY_SVG,
  XLSX_MIME,
  cleanupEntriesOf,
  createAssetsReader,
  docxBytes,
  forgetAssets,
  pdfBytes,
  replaceAsset,
  runName,
  uploadAsset,
  xlsxBytes,
  type AssetBody,
} from '../../helpers/asset-replace-fixtures.js';

/**
 * `specs/156-asset-stable-url/` T026 — `POST /api/v1/admin/assets/:id/replace`
 * (contracts/admin-api.md §2; FR-001 – FR-010, US1).
 */

interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

describe('POST /api/v1/admin/assets/:id/replace (feature 156)', () => {
  let h: BackendServerHandle;
  let store: Awaited<ReturnType<typeof useTemporaryAssetStore>>;
  const created: string[] = [];
  const products: string[] = [];
  let reader: Awaited<ReturnType<typeof createAssetsReader>>;

  beforeAll(async () => {
    h = await setupBackendServer();
    store = await useTemporaryAssetStore(h);
    reader = await createAssetsReader(h);
  }, 120_000);

  afterAll(async () => {
    await forgetAssets(h, created);
    for (const productId of products) {
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/products/${productId}`,
        cookies: ADMIN,
      });
    }
    await reader.undo();
    await store.undo();
    await teardownBackendServer(h);
  });

  async function upload(filename: string, mime: string, value: Buffer, fields: Record<string, string> = {}) {
    const asset = await uploadAsset(h, { filename, mime, value }, fields);
    created.push(asset.id);
    return asset;
  }

  async function detail(id: string): Promise<AssetBody> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/assets/${id}`, cookies: ADMIN });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: AssetBody }).data;
  }

  async function attachTo(assetId: string): Promise<string> {
    const product = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies: ADMIN,
      payload: {
        sku: `${runName()}-SKU`,
        type: 'simple',
        name: 'Replace fixture',
        description: '',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(product.statusCode, product.body).toBe(201);
    const productId = (product.json() as { data: { id: string } }).data.id;
    products.push(productId);
    const types = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attachment-types',
      cookies: ADMIN,
    });
    const pdfType = (types.json() as { data: Array<{ id: string; code: string }> }).data.find(
      (t) => t.code === 'pdf',
    );
    const attach = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      cookies: ADMIN,
      payload: { assetId, attachmentTypeId: pdfType!.id, name: 'Certificate', description: '' },
    });
    expect(attach.statusCode, attach.body).toBe(201);
    return productId;
  }

  async function expectNoLeftoverCleanups(assetId: string): Promise<void> {
    expect(await cleanupEntriesOf(h, assetId)).toEqual([]);
  }

  it('replaces a PDF in place: same id, folder, label, alt text, visibility and references; new file and version', async () => {
    const asset = await upload(`${runName()}-certificate.pdf`, 'application/pdf', pdfBytes('one'), {
      label: 'Quality certificate',
    });
    await h.em().nativeUpdate(Asset, { id: asset.id }, { altText: { 'en-US': 'Certificate' } });
    const productId = await attachTo(asset.id);
    const before = await h.app.inject({ method: 'GET', url: `/assets/file/${asset.id}` });
    expect(before.statusCode).toBe(200);
    const oldEtag = String(before.headers.etag);

    const second = pdfBytes('two — a longer second version of the certificate');
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}-certificate-2026.pdf`,
      mime: 'application/pdf',
      value: second,
    });
    expect(res.statusCode, res.body).toBe(200);
    const after = (res.json() as { data: AssetBody }).data;
    expect(after.id).toBe(asset.id);
    expect(after.folderId).toBe(asset.folderId);
    expect(after.label).toBe('Quality certificate');
    expect(after.altText).toEqual({ 'en-US': 'Certificate' });
    expect(after.visibility).toBe('public');
    expect(after.references.map((r) => r.entityId)).toContain(productId);
    expect(after.filename).toMatch(/-certificate-2026\.pdf$/);
    expect(after.mimeType).toBe('application/pdf');
    expect(after.sizeBytes).toBe(second.length);
    expect(after.contentVersion).not.toBe(asset.contentVersion);

    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${asset.id}` });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(second)).toBe(true);
    expect(served.headers['content-type']).toBe('application/pdf');
    const conditional = await h.app.inject({
      method: 'GET',
      url: `/assets/file/${asset.id}`,
      headers: { 'if-none-match': oldEtag },
    });
    expect(conditional.statusCode).toBe(200);

    const audit = await h.em().find(AuditLogEntry, { action: 'asset.replace', objectId: asset.id });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.stateBefore).toMatchObject({
      filename: asset.filename,
      mimeType: 'application/pdf',
      sizeBytes: asset.sizeBytes,
    });
    expect(audit[0]!.stateAfter).toMatchObject({
      filename: after.filename,
      mimeType: 'application/pdf',
      sizeBytes: second.length,
    });
    await expectNoLeftoverCleanups(asset.id);
  });

  it('clears an admin MIME override', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('override'));
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/assets/${asset.id}`,
      cookies: ADMIN,
      payload: { mimeType: 'application/x-custom-pdf' },
    });
    expect(patch.statusCode).toBe(200);
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('override-2'),
    });
    expect(res.statusCode, res.body).toBe(200);
    const row = await h.em().findOneOrFail(Asset, { id: asset.id });
    expect(row.mimeTypeOverridden).toBe(false);
    expect(row.mimeType).toBe('application/pdf');
  });

  it('keeps the storage key when a .jpg is replaced by a .png, and serves the new type and name', async () => {
    const asset = await upload(`${runName()}.jpg`, 'image/jpeg', TINY_JPEG);
    const locator = (await h.em().findOneOrFail(Asset, { id: asset.id })).storageLocator;
    const filename = `${runName()}-new.png`;
    const res = await replaceAsset(h, asset.id, { filename, mime: 'image/png', value: TINY_PNG });
    expect(res.statusCode, res.body).toBe(200);
    expect((await h.em().findOneOrFail(Asset, { id: asset.id })).storageLocator).toBe(locator);
    const served = await h.app.inject({ method: 'GET', url: `/assets/file/${asset.id}` });
    expect(served.headers['content-type']).toBe('image/png');
    expect(String(served.headers['content-disposition'])).toContain(filename);
    expect(served.rawPayload.equals(TINY_PNG)).toBe(true);
  });

  it('accepts an SVG for an image', async () => {
    const asset = await upload(`${runName()}.png`, 'image/png', TINY_PNG);
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.svg`,
      mime: 'image/svg+xml',
      value: TINY_SVG,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: AssetBody }).data.mimeType).toBe('image/svg+xml');
  });

  it.each([
    ['a PDF by a DOCX', 'pdf', 'other'],
    ['an image by a PDF', 'image', 'pdf'],
    ['an image by text declared image/png', 'image', 'other'],
  ] as const)('refuses %s with 415 ASSET_REPLACE_KIND_MISMATCH and changes nothing', async (_label, currentKind, newKind) => {
    const asset =
      currentKind === 'pdf'
        ? await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('kind'))
        : await upload(`${runName()}.png`, 'image/png', TINY_PNG);
    const file =
      newKind === 'pdf'
        ? { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('x') }
        : currentKind === 'pdf'
          ? { filename: `${runName()}.docx`, mime: DOCX_MIME, value: docxBytes() }
          : { filename: `${runName()}.png`, mime: 'image/png', value: Buffer.from('not an image') };
    const res = await replaceAsset(h, asset.id, file);
    expect(res.statusCode, res.body).toBe(415);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe('ASSET_REPLACE_KIND_MISMATCH');
    expect(body.error.details).toMatchObject({ currentKind, newKind });
    const now = await detail(asset.id);
    expect(now.filename).toBe(asset.filename);
    expect(now.contentVersion).toBe(asset.contentVersion);
    await expectNoLeftoverCleanups(asset.id);
  });

  it('refuses an HTML file with 415 ASSET_UPLOAD_TYPE_NOT_ALLOWED', async () => {
    const asset = await upload(`${runName()}.docx`, DOCX_MIME, docxBytes());
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.html`,
      mime: 'text/html',
      value: Buffer.from('<!doctype html><p>x</p>'),
    });
    expect(res.statusCode).toBe(415);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_UPLOAD_TYPE_NOT_ALLOWED');
    await expectNoLeftoverCleanups(asset.id);
  });

  it('accepts a DOCX replaced by an XLSX', async () => {
    const asset = await upload(`${runName()}.docx`, DOCX_MIME, docxBytes());
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.xlsx`,
      mime: XLSX_MIME,
      value: xlsxBytes(),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: AssetBody }).data.mimeType).toBe(XLSX_MIME);
  });

  it('keeps a certificate a certificate, and its attachment listed', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('cert'));
    await h.em().nativeUpdate(Asset, { id: asset.id }, { kind: 'certificate' });
    const productId = await attachTo(asset.id);
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}-2.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('cert-2'),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await h.em().findOneOrFail(Asset, { id: asset.id })).kind).toBe('certificate');
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      cookies: ADMIN,
    });
    expect(JSON.stringify(list.json())).toContain(asset.id);
  });

  it('applies the upload size cap and type policy, with the settings restored', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('policy'));
    const restoreSize = await overrideAssetSetting(h, 'assets.max_file_size_mb', 1);
    try {
      const big = Buffer.concat([pdfBytes('big'), Buffer.alloc(2 * 1024 * 1024, 0x20)]);
      const res = await replaceAsset(h, asset.id, {
        filename: `${runName()}.pdf`,
        mime: 'application/pdf',
        value: big,
      });
      expect(res.statusCode, res.body).toBe(413);
      expect((res.json() as ErrorBody).error.code).toBe('ASSET_UPLOAD_TOO_LARGE');
    } finally {
      await restoreSize();
    }
    const restoreTypes = await overrideAssetSetting(h, 'assets.allowed_file_types', ['image/png']);
    try {
      const res = await replaceAsset(h, asset.id, {
        filename: `${runName()}.pdf`,
        mime: 'application/pdf',
        value: pdfBytes('types'),
      });
      expect(res.statusCode, res.body).toBe(415);
      expect((res.json() as ErrorBody).error.code).toBe('ASSET_UPLOAD_TYPE_NOT_ALLOWED');
    } finally {
      await restoreTypes();
    }
    expect((await detail(asset.id)).contentVersion).toBe(asset.contentVersion);
    await expectNoLeftoverCleanups(asset.id);
  });

  it('refuses a legacy row with 409 ASSET_LEGACY_CANNOT_REPLACE', async () => {
    const em = h.em();
    const legacy = em.create(Asset, {
      kind: 'pdf',
      filename: `${runName()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '10',
      storageUrl: 'https://legacy.example.test/certificate.pdf',
      storageLocator: 'https://legacy.example.test/certificate.pdf',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(legacy);
    created.push(legacy.id);
    const res = await replaceAsset(h, legacy.id, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('legacy'),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_LEGACY_CANNOT_REPLACE');
  });

  // Owner ruling S3 (2026-10-19): a row with no storage key — the demo seed's
  // `data:` images, inserted by raw SQL — is refused like a legacy row, never 503,
  // and the detail says so, so the drawer can hide Replace file.
  it('refuses a row with no storage key like a legacy row, on replace and restore, and marks it not replaceable', async () => {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', ?, 'image/svg+xml', 120, ?, now(), now())`,
      [id, `${runName()}.svg`, 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='],
    );
    created.push(id);
    const res = await replaceAsset(h, id, { filename: `${runName()}.svg`, mime: 'image/svg+xml', value: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_LEGACY_CANNOT_REPLACE');
    const before = await detail(id);
    expect(before.replaceable).toBe(false);
    const restore = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/assets/${id}/previous-version/restore`,
      cookies: ADMIN,
      payload: { expectedContentVersion: before.contentVersion, expectedPreviousContentVersion: 'aaaaaaaaaaaa' },
    });
    expect(restore.statusCode, restore.body).toBe(409);
    expect((restore.json() as ErrorBody).error.code).toBe('ASSET_LEGACY_CANNOT_REPLACE');
    const rows = await h.em().getConnection().execute<Array<{ storage_url: string }>>(
      'select storage_url from assets where id = ?',
      [id],
    );
    expect(rows[0]?.storage_url.startsWith('data:image/svg+xml')).toBe(true);
  });

  it('marks an uploaded asset replaceable and a legacy row not', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('replaceable'));
    expect((await detail(asset.id)).replaceable).toBe(true);
    const em = h.em();
    const legacy = em.create(Asset, {
      kind: 'pdf',
      filename: `${runName()}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: '10',
      storageUrl: 'https://legacy.example.test/sheet.pdf',
      storageLocator: 'https://legacy.example.test/sheet.pdf',
      storageBackend: 'legacy',
      visibility: 'public',
    });
    await em.persistAndFlush(legacy);
    created.push(legacy.id);
    expect((await detail(legacy.id)).replaceable).toBe(false);
  });

  it('refuses a soft-deleted asset with 410', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('gone'));
    const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${asset.id}`, cookies: ADMIN });
    expect(del.statusCode).toBe(200);
    const res = await replaceAsset(h, asset.id, {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('gone-2'),
    });
    expect(res.statusCode).toBe(410);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_GONE');
  });

  it('refuses an admin holding only assets.read with 403 and leaves the asset unchanged', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('reader'));
    const res = await replaceAsset(
      h,
      asset.id,
      { filename: `${runName()}.pdf`, mime: 'application/pdf', value: pdfBytes('reader-2') },
      { cookies: reader.cookies },
    );
    expect(res.statusCode).toBe(403);
    expect((await detail(asset.id)).contentVersion).toBe(asset.contentVersion);
  });

  it('answers 400 ASSET_UPLOAD_NO_FILE for a body without a file part', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('nofile'));
    const res = await replaceAsset(h, asset.id, null);
    expect(res.statusCode).toBe(400);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_UPLOAD_NO_FILE');
  });

  it('answers 404 ASSET_NOT_FOUND for an unknown id', async () => {
    const res = await replaceAsset(h, randomUUID(), {
      filename: `${runName()}.pdf`,
      mime: 'application/pdf',
      value: pdfBytes('missing'),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as ErrorBody).error.code).toBe('ASSET_NOT_FOUND');
  });

  // Block review I — one file per request: a second file part is ignored, and
  // the answer reports what the first one did (the upload route the same).
  it('answers 200 with the replace when a second file part follows, ignoring it', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('two-parts'));
    const first = `${runName()}-first.pdf`;
    const { body, contentType } = multipartBody([
      { name: 'file', filename: first, mime: 'application/pdf', value: pdfBytes('first') },
      { name: 'file', filename: `${runName()}-second.pdf`, mime: 'application/pdf', value: pdfBytes('second') },
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/assets/${asset.id}/replace`,
      headers: { 'content-type': contentType },
      cookies: ADMIN,
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: AssetBody }).data.filename).toBe(first);
    expect((await detail(asset.id)).filename).toBe(first);
  });

  // Security review: the guard field must come first. One that arrives after the
  // file would have been skipped; it is refused before anything is committed.
  it('refuses expectedContentVersion sent after the file part with 400 VALIDATION_FAILED, changing nothing', async () => {
    const asset = await upload(`${runName()}.pdf`, 'application/pdf', pdfBytes('late-field'));
    const { body, contentType } = multipartBody([
      { name: 'file', filename: `${runName()}-late.pdf`, mime: 'application/pdf', value: pdfBytes('late') },
      { name: 'expectedContentVersion', value: asset.contentVersion },
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/assets/${asset.id}/replace`,
      headers: { 'content-type': contentType },
      cookies: ADMIN,
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(400);
    const error = (res.json() as { error: { code: string; message: string } }).error;
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.message).toMatch(/expectedContentVersion.*before the file/);
    const after = await detail(asset.id);
    expect(after.filename).toBe(asset.filename);
    expect(after.contentVersion).toBe(asset.contentVersion);
    expect(await cleanupEntriesOf(h, asset.id)).toEqual([]);
  });

  it('answers 201 with one asset when an upload carries a second file part, ignoring it', async () => {
    const first = `${runName()}-first.pdf`;
    const second = `${runName()}-second.pdf`;
    const { body, contentType } = multipartBody([
      { name: 'file', filename: first, mime: 'application/pdf', value: pdfBytes('first') },
      { name: 'file', filename: second, mime: 'application/pdf', value: pdfBytes('second') },
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/assets',
      headers: { 'content-type': contentType },
      cookies: ADMIN,
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: AssetBody }).data.id;
    created.push(id);
    expect((res.json() as { data: AssetBody }).data.filename).toBe(first);
    expect(await h.em().fork().count(Asset, { filename: second })).toBe(0);
  });
});
