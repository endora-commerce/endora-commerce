import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 / T010 — DB-level invariants for `POST /products/bulk-update`.
 *
 * Asserts (via direct DB introspection) the side effects of the bulk
 * endpoint on `products.status` / `products.archived_at`,
 * `sales_channel_products`, `product_categories`, and a one-row summary
 * on `audit_log_entries`. The narrower contract test
 * (`products-bulk-update.test.ts`) only asserts the HTTP response
 * shape; this test is the regression guard for the writes themselves.
 */
describe('Feature 022 — POST /products/bulk-update (DB-level invariants)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(sku: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku,
        type: 'simple',
        name: { 'en-US': sku },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function getChannelIdByCode(code: string): Promise<string> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select id from sales_channels where code = ?`, [code])) as Array<{
      id: string;
    }>;
    expect(rows[0]).toBeDefined();
    return rows[0]!.id;
  }

  async function getCategoryIdBySlug(slug: string): Promise<string> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select id from categories where slug = ?`, [slug])) as Array<{
      id: string;
    }>;
    expect(rows[0]).toBeDefined();
    return rows[0]!.id;
  }

  async function readProductStatusRow(
    id: string,
  ): Promise<{ status: string; archivedAt: Date | null }> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ status: string; archived_at: Date | null }>>(
        `select status, archived_at from products where id = ?`,
        [id],
      )) as Array<{ status: string; archived_at: Date | null }>;
    expect(rows[0]).toBeDefined();
    return { status: rows[0]!.status, archivedAt: rows[0]!.archived_at };
  }

  async function readChannelIdsForProduct(productId: string): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ sales_channel_id: string }>>(
        `select sales_channel_id from sales_channel_products where product_id = ? order by sales_channel_id`,
        [productId],
      )) as Array<{ sales_channel_id: string }>;
    return rows.map((r) => r.sales_channel_id);
  }

  async function readCategoryIdsForProduct(productId: string): Promise<string[]> {
    const rows = (await h
      .em()
      .getConnection()
      .execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ? order by category_id`,
        [productId],
      )) as Array<{ category_id: string }>;
    return rows.map((r) => r.category_id);
  }

  it('status=archived writes status + archived_at to every product in the batch', async () => {
    const a = await createProduct('BULK-DBINV-ARCH-001');
    const b = await createProduct('BULK-DBINV-ARCH-002');
    const before = Date.now();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [a, b],
        fields: { status: 'inactive' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);

    for (const id of [a, b]) {
      const row = await readProductStatusRow(id);
      expect(row.status).toBe('inactive');
      expect(row.archivedAt).not.toBeNull();
      expect(new Date(row.archivedAt!).getTime()).toBeGreaterThanOrEqual(before);
    }

    // Reactivation clears archived_at on every product.
    const res2 = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [a, b],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res2.statusCode).toBe(200);
    for (const id of [a, b]) {
      const row = await readProductStatusRow(id);
      expect(row.status).toBe('active');
      expect(row.archivedAt).toBeNull();
    }
  });

  it('salesChannels { mode: "replace" } sets sales_channel_products to exactly the target set', async () => {
    const id = await createProduct('BULK-DBINV-CHAN-REPL-001');
    const retail = await getChannelIdByCode('pl_retail');
    const b2bVip = await getChannelIdByCode('pl_b2b_vip');

    // Seed with replace [retail, b2bVip] — drops the auto-bound default
    // channel inserted by createProduct.bindToDefaultIfEmpty so we start
    // from a known-exact 2-element set.
    const seed = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { salesChannels: { mode: 'replace', channelIds: [retail, b2bVip] } },
      },
      cookies: adminCookie,
    });
    expect(seed.statusCode).toBe(200);
    expect((await readChannelIdsForProduct(id)).sort()).toEqual([retail, b2bVip].sort());

    // Replace with just retail.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { salesChannels: { mode: 'replace', channelIds: [retail] } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(await readChannelIdsForProduct(id)).toEqual([retail]);
  });

  it('salesChannels { mode: "add" } unions with current rows (does not remove)', async () => {
    const id = await createProduct('BULK-DBINV-CHAN-ADD-001');
    const retail = await getChannelIdByCode('pl_retail');
    const b2bVip = await getChannelIdByCode('pl_b2b_vip');

    // Seed with replace [retail] so we start from a known-exact 1-channel set.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { salesChannels: { mode: 'replace', channelIds: [retail] } },
      },
      cookies: adminCookie,
    });
    expect(await readChannelIdsForProduct(id)).toEqual([retail]);

    // Add b2bVip — must not drop retail.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { salesChannels: { mode: 'add', channelIds: [b2bVip] } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect((await readChannelIdsForProduct(id)).sort()).toEqual([retail, b2bVip].sort());
  });

  it('categories { mode: "replace" } sets product_categories to exactly the target set', async () => {
    const id = await createProduct('BULK-DBINV-CAT-REPL-001');
    const root = await getCategoryIdBySlug('widgets');
    const small = await getCategoryIdBySlug('small-widgets');
    const large = await getCategoryIdBySlug('large-widgets');

    // Seed with root + small via 'add'.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { categories: { mode: 'add', categoryIds: [root, small] } },
      },
      cookies: adminCookie,
    });
    expect((await readCategoryIdsForProduct(id)).sort()).toEqual([root, small].sort());

    // Replace with just large.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { categories: { mode: 'replace', categoryIds: [large] } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect(await readCategoryIdsForProduct(id)).toEqual([large]);
  });

  it('categories { mode: "add" } unions with current rows (does not remove)', async () => {
    const id = await createProduct('BULK-DBINV-CAT-ADD-001');
    const root = await getCategoryIdBySlug('widgets');
    const small = await getCategoryIdBySlug('small-widgets');
    const large = await getCategoryIdBySlug('large-widgets');

    // Seed with root.
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { categories: { mode: 'replace', categoryIds: [root] } },
      },
      cookies: adminCookie,
    });
    expect(await readCategoryIdsForProduct(id)).toEqual([root]);

    // Add small + large.
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [id],
        fields: { categories: { mode: 'add', categoryIds: [small, large] } },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect((await readCategoryIdsForProduct(id)).sort()).toEqual([root, small, large].sort());
  });

  it('emits exactly one product.bulk_update audit row carrying the selection + summary', async () => {
    const a = await createProduct('BULK-DBINV-AUDIT-001');
    const b = await createProduct('BULK-DBINV-AUDIT-002');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/bulk-update',
      payload: {
        productIds: [a, b],
        fields: { status: 'active' },
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { bulkOperationId: string } };
    const bulkOperationId = body.data.bulkOperationId;

    const rows = (await h
      .em()
      .getConnection()
      .execute<
        Array<{
          action: string;
          object_type: string;
          object_id: string;
          state_after: {
            selectionIds?: string[];
            touchedFields?: string[];
            resultsSummary?: { succeeded: number; skipped: number; failed: number; total: number };
          };
        }>
      >(
        `select action, object_type, object_id, state_after from audit_log_entries where action = ? and object_id = ?`,
        ['product.bulk_update', bulkOperationId],
      )) as Array<{
      action: string;
      object_type: string;
      object_id: string;
      state_after: {
        selectionIds?: string[];
        touchedFields?: string[];
        resultsSummary?: { succeeded: number; skipped: number; failed: number; total: number };
      };
    }>;
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.action).toBe('product.bulk_update');
    expect(r.object_type).toBe('bulk_operation');
    expect(r.state_after.selectionIds?.sort()).toEqual([a, b].sort());
    expect(r.state_after.touchedFields).toContain('status');
    expect(r.state_after.resultsSummary?.total).toBe(2);
    expect(r.state_after.resultsSummary?.succeeded).toBe(2);
  });
});
