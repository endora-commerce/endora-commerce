import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T059 — Contract test for AttachmentTypes (global dictionary) +
 * ProductAttachments (per-product wrapper around an Asset). Feature 002
 * US3 — see data-model.md §2.5, §2.6.
 *
 * Endpoints:
 *   GET    /api/v1/admin/catalog/attachment-types
 *   POST   /api/v1/admin/catalog/attachment-types
 *   PATCH  /api/v1/admin/catalog/attachment-types/:id
 *   DELETE /api/v1/admin/catalog/attachment-types/:id
 *   GET    /api/v1/admin/catalog/products/:productId/attachments
 *   POST   /api/v1/admin/catalog/products/:productId/attachments
 *   PATCH  /api/v1/admin/catalog/products/:productId/attachments/:attachmentId
 *   DELETE /api/v1/admin/catalog/products/:productId/attachments/:attachmentId
 *
 * Errors:
 *   - 409 ATTACHMENT_TYPE_CODE_TAKEN on duplicate code
 *   - 409 ATTACHMENT_TYPE_IN_USE on delete with usageCount>0
 *   - 400 ASSET_KIND_NOT_SUPPORTED when asset.kind is image/video
 *   - 404 ATTACHMENT_TYPE_NOT_FOUND / ATTACHMENT_NOT_FOUND
 */

describe('Admin Attachments contract (T059)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(suffix: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `ATT-PARENT-${suffix}`,
        type: 'simple',
        name: { 'en-US': `Attachment parent ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function seedAsset(kind: 'image' | 'video' | 'pdf' | 'certificate' | 'other'): Promise<string> {
    const conn = h.orm.em.getConnection();
    const id = crypto.randomUUID();
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, ?, 'doc.pdf', 'application/pdf', 1024, 'https://example.test/a.pdf', now(), now())`,
      [id, kind],
    );
    return id;
  }

  it('GET attachment-types lists the seeded standard types', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attachment-types',
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const codes = (res.json() as { data: Array<{ code: string }> }).data.map((t) => t.code);
    // Migration 021 seeds 4 standard types.
    expect(codes).toEqual(expect.arrayContaining(['certificate', 'tech_spec', 'product_card', 'pdf']));
  });

  it('POST creates a custom attachment-type; second with same code → 409', async () => {
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attachment-types',
      payload: { code: 'safety_data_sheet', name: { 'en-US': 'Safety Data Sheet' } },
      cookies: adminCookie,
    });
    expect(first.statusCode).toBe(201);

    const dupe = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attachment-types',
      payload: { code: 'safety_data_sheet', name: { 'en-US': 'Whatever' } },
      cookies: adminCookie,
    });
    expect(dupe.statusCode).toBe(409);
    expect((dupe.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ATTACHMENT_TYPE_CODE_TAKEN,
    );
  });

  it('POST product attachment links an Asset to a Product; GET lists it', async () => {
    const productId = await createProduct('A');
    const assetId = await seedAsset('pdf');
    // Reuse the seeded `pdf` attachment-type.
    const types = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attachment-types',
      cookies: adminCookie,
    });
    const pdfType = (types.json() as { data: Array<{ id: string; code: string }> }).data.find(
      (t) => t.code === 'pdf',
    );
    expect(pdfType).toBeDefined();

    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      payload: {
        assetId,
        attachmentTypeId: pdfType!.id,
        name: 'Datasheet 2026',
        description: 'For T059',
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);

    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      cookies: adminCookie,
    });
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { data: Array<{ name: string }> }).data;
    expect(items.length).toBe(1);
    expect(items[0]!.name).toBe('Datasheet 2026');
  });

  it('POST rejects an image asset with 400 ASSET_KIND_NOT_SUPPORTED', async () => {
    const productId = await createProduct('B');
    const imageAsset = await seedAsset('image');
    const types = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attachment-types',
      cookies: adminCookie,
    });
    const pdfType = (types.json() as { data: Array<{ id: string; code: string }> }).data.find(
      (t) => t.code === 'pdf',
    )!;

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      payload: {
        assetId: imageAsset,
        attachmentTypeId: pdfType.id,
        name: 'Bad attachment',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ASSET_KIND_NOT_SUPPORTED,
    );
  });

  it('DELETE attachment-type with attached usage → 409 ATTACHMENT_TYPE_IN_USE', async () => {
    // Create a fresh type, attach to a product, then try to delete the type.
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attachment-types',
      payload: { code: 'in_use_type', name: { 'en-US': 'In use' } },
      cookies: adminCookie,
    });
    const typeId = (created.json() as { data: { id: string } }).data.id;
    const productId = await createProduct('C');
    const assetId = await seedAsset('pdf');
    const attach = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      payload: { assetId, attachmentTypeId: typeId, name: 'Some doc' },
      cookies: adminCookie,
    });
    expect(attach.statusCode).toBe(201);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/attachment-types/${typeId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ATTACHMENT_TYPE_IN_USE,
    );
  });

  it('DELETE attachment removes only the link; Asset survives', async () => {
    const productId = await createProduct('D');
    const assetId = await seedAsset('pdf');
    const types = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/attachment-types',
      cookies: adminCookie,
    });
    const pdfType = (types.json() as { data: Array<{ id: string; code: string }> }).data.find(
      (t) => t.code === 'pdf',
    )!;

    const create = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/attachments`,
      payload: { assetId, attachmentTypeId: pdfType.id, name: 'To delete' },
      cookies: adminCookie,
    });
    const attachmentId = (create.json() as { data: { id: string } }).data.id;

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${productId}/attachments/${attachmentId}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);

    // Asset still exists in the assets table.
    const conn = h.orm.em.getConnection();
    const rows = (await conn.execute(`select id from assets where id = ?`, [assetId])) as Array<{
      id: string;
    }>;
    expect(rows.length).toBe(1);
  });
});
