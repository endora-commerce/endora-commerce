import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T057 + T061 — integration coverage of the load-bearing US3 invariants
 * that contract tests don't already pin:
 *
 *   T057 (Gallery flow tail): thumbnail-resolver fallback to null when
 *        the product has neither a gallery nor a legacy product_assets
 *        row. The chain is asserted top-down by gallery-resolution.test;
 *        this covers the bottom (null) case.
 *
 *   T061 (Attachment flow tail): the underlying Asset is shared across
 *        Products — deleting a ProductAttachment on one product MUST NOT
 *        affect another product that references the same Asset. This is
 *        the M:N invariant from research R-9 (no duplicated storage).
 */

describe('US3 cross-cutting flows (T057 + T061)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(suffix: string): Promise<{ id: string; slug: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `US3-FLOW-${suffix}`,
        type: 'simple',
        name: { 'en-US': `US3 flow ${suffix}` },
        description: { 'en-US': '' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; slug: string } }).data;
    const conn = h.orm.em.getConnection();
    const [retail] = await conn.execute<{ id: string }[]>(
      `select id from sales_channels where code = 'pl_retail'`,
    );
    if (retail) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
        [retail.id, data.id],
      );
    }
    await conn.execute(`update products set status = 'active' where id = ?`, [data.id]);
    return data;
  }

  async function seedAsset(kind: string, url: string): Promise<string> {
    const conn = h.orm.em.getConnection();
    const id = crypto.randomUUID();
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, ?, 'test.bin', 'application/octet-stream', 1024, ?, now(), now())`,
      [id, kind, url],
    );
    return id;
  }

  it('T057: primaryAssetUrl is null when product has neither gallery nor legacy assets', async () => {
    const product = await createProduct('NULL-FALLBACK');
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?q=US3-FLOW-NULL-FALLBACK',
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      data: Array<{ slug: string; primaryAssetUrl: string | null }>;
    };
    const found = body.data.find((p) => p.slug === product.slug);
    expect(found?.primaryAssetUrl).toBeNull();
  });

  it('T061: Asset shared across products — deleting one attachment leaves the other intact', async () => {
    const productA = await createProduct('SHARE-A');
    const productB = await createProduct('SHARE-B');
    const sharedAssetId = await seedAsset('pdf', 'https://cdn.test/shared.pdf');

    // Pick the seeded "certificate" type (deterministic UUID per migration 021).
    const conn = h.orm.em.getConnection();
    const [certType] = await conn.execute<{ id: string }[]>(
      `select id from attachment_types where code = 'certificate' limit 1`,
    );
    expect(certType).toBeDefined();

    const attachToProduct = async (
      productId: string,
      label: string,
    ): Promise<string> => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${productId}/attachments`,
        payload: {
          assetId: sharedAssetId,
          attachmentTypeId: certType!.id,
          name: label,
        },
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { data: { id: string } }).data.id;
    };
    const attA = await attachToProduct(productA.id, 'Cert on A');
    const attB = await attachToProduct(productB.id, 'Cert on B');

    // Delete the attachment on Product A.
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/catalog/products/${productA.id}/attachments/${attA}`,
      cookies: adminCookie,
    });
    expect(del.statusCode).toBe(204);

    // Product B still surfaces the shared Asset via its untouched
    // ProductAttachment row — the M:N invariant from research R-9.
    const detailB = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productB.slug}`,
    });
    expect(detailB.statusCode).toBe(200);
    const bodyB = detailB.json() as {
      data: {
        attachments?: Array<{ id: string; asset: { id: string; url: string } }>;
      };
    };
    const stillThere = bodyB.data.attachments?.find((a) => a.id === attB);
    expect(stillThere).toBeDefined();
    expect(stillThere?.asset.id).toBe(sharedAssetId);
    expect(stillThere?.asset.url).toBe('https://cdn.test/shared.pdf');

    // The Asset row itself MUST still exist (deleting an attachment must
    // not cascade to the underlying file) — read directly to confirm.
    const [assetRow] = await conn.execute<{ id: string }[]>(
      `select id from assets where id = ?`,
      [sharedAssetId],
    );
    expect(assetRow?.id).toBe(sharedAssetId);
  });

  it('T061: ATTACHMENT_TYPE_IN_USE blocks deletion when at least one attachment uses the type', async () => {
    const product = await createProduct('TYPE-IN-USE');
    const assetId = await seedAsset('pdf', 'https://cdn.test/type-in-use.pdf');

    // Create a custom attachment type so we own the lifecycle.
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/attachment-types',
      payload: { code: 'custom_type_x', name: { 'en-US': 'Custom X' } },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const typeId = (create.json() as { data: { id: string } }).data.id;

    // Use the type on a single attachment.
    const att = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/attachments`,
      payload: { assetId, attachmentTypeId: typeId, name: 'Custom doc' },
      cookies: adminCookie,
    });
    expect(att.statusCode).toBe(201);

    // Now try to delete the type — must be blocked.
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
});
