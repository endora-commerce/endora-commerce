import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogBulkImportPort, CatalogProductReadPort } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Issue #693 — deleting a product frees its SKU, and the SKUs of its variants.
 *
 * `product.delete` is a soft delete with no undo, and the admin has no view of deleted rows,
 * so a SKU a deleted row kept was taken for good. The deleted row keeps its real SKU (audit,
 * ERP/PIM reconciliation); uniqueness holds among live rows only, and every lookup by SKU
 * either ignores deleted rows or prefers the live one.
 */
describe('Issue #693 — a deleted product frees its SKU', () => {
  let h: BackendServerHandle;
  let writeToken: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  /** The `inventory` module's seeded default warehouse. */
  const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

  beforeAll(async () => {
    h = await setupBackendServer();
    const key = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'Issue 693 writer', scopes: ['catalog:write'] },
      cookies: adminCookie,
    });
    writeToken = (key.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function cradle(): { catalogProductReadPort: CatalogProductReadPort; catalogBulkImportPort: CatalogBulkImportPort } {
    return h.container.cradle as never;
  }

  async function createProduct(sku: string, type: 'simple' | 'configurable' = 'simple'): Promise<{ status: number; id: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: { sku, type, name: sku, description: 'desc', categoryIds: [], attributeValues: {}, visibility: 'public' },
      cookies: adminCookie,
    });
    return { status: res.statusCode, id: (res.json() as { data?: { id: string } }).data?.id ?? '' };
  }

  async function createVariant(parentId: string, sku: string): Promise<number> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parentId}/variants`,
      payload: { sku, variantAttributeValues: { color: 'red' } },
      cookies: adminCookie,
    });
    return res.statusCode;
  }

  async function deleteProduct(id: string): Promise<void> {
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/catalog/products/${id}`, cookies: adminCookie });
    expect(res.statusCode).toBe(204);
  }

  /** A live product and a deleted one, both holding `sku`; the deleted one was created first. */
  async function liveBesideDeleted(sku: string): Promise<{ liveId: string; deletedId: string }> {
    const first = await createProduct(sku);
    expect(first.status).toBe(201);
    await deleteProduct(first.id);
    const second = await createProduct(sku);
    expect(second.status).toBe(201);
    return { liveId: second.id, deletedId: first.id };
  }

  it('creates a product with the SKU of a deleted one (the issue\'s reproduction)', async () => {
    const first = await createProduct('I693-X-1');
    expect(first.status).toBe(201);
    await deleteProduct(first.id);

    const again = await createProduct('I693-X-1');
    expect(again.status).toBe(201);
    expect(again.id).not.toBe(first.id);

    // The deleted row keeps its real SKU.
    const rows = (await h.em().getConnection().execute(
      `select "id", "sku", "deleted_at" from "products" where "sku" = 'I693-X-1' order by "created_at"`,
    )) as Array<{ id: string; sku: string; deleted_at: Date | null }>;
    expect(rows.map((r) => [r.id, r.deleted_at === null])).toEqual([
      [first.id, false],
      [again.id, true],
    ]);

    // Uniqueness still holds among live rows.
    expect((await createProduct('I693-X-1')).status).toBe(409);
  });

  it('frees the SKUs of a deleted product\'s variants', async () => {
    const parent = await createProduct('I693-VAR-PARENT', 'configurable');
    expect(parent.status).toBe(201);
    expect(await createVariant(parent.id, 'I693-VAR-1')).toBe(201);
    expect(await createVariant(parent.id, 'I693-VAR-2')).toBe(201);
    await deleteProduct(parent.id);

    const variants = (await h.em().getConnection().execute(
      `select "deleted_at" from "product_variants" where "parent_product_id" = ?`,
      [parent.id],
    )) as Array<{ deleted_at: Date | null }>;
    expect(variants).toHaveLength(2);
    expect(variants.every((v) => v.deleted_at !== null)).toBe(true);

    // A new variant may take a deleted variant's SKU …
    const other = await createProduct('I693-VAR-OTHER', 'configurable');
    expect(await createVariant(other.id, 'I693-VAR-1')).toBe(201);
    // … and so may a product: the two share one namespace.
    const simple = await createProduct('I693-VAR-SIMPLE');
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${simple.id}`,
      payload: { sku: 'I693-VAR-2' },
      cookies: adminCookie,
    });
    expect(patch.statusCode).toBe(200);

    // A live variant still holds its SKU against a product and against another variant.
    const refused = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${simple.id}`,
      payload: { sku: 'I693-VAR-1' },
      cookies: adminCookie,
    });
    expect(refused.statusCode).toBe(400);
    expect(await createVariant(other.id, 'I693-VAR-1')).toBe(409);
  });

  it('a variant takes the SKU of a deleted product', async () => {
    const gone = await createProduct('I693-PROD-TO-VAR');
    await deleteProduct(gone.id);
    const parent = await createProduct('I693-PROD-TO-VAR-PARENT', 'configurable');
    expect(await createVariant(parent.id, 'I693-PROD-TO-VAR')).toBe(201);
  });

  it('a duplicate takes a "-copy" SKU that only a deleted product holds', async () => {
    const source = await createProduct('I693-DUP');
    const dup = async (): Promise<{ id: string; sku: string }> => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/products/${source.id}/duplicate`,
        cookies: adminCookie,
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { data: { id: string; sku: string } }).data;
    };
    const first = await dup();
    expect(first.sku).toBe('I693-DUP-copy');
    await deleteProduct(first.id);
    expect((await dup()).sku).toBe('I693-DUP-copy');
  });

  it('PUT /catalog/products/by-sku creates a new product when only a deleted one holds the SKU', async () => {
    const gone = await createProduct('I693-API-1');
    await deleteProduct(gone.id);

    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/I693-API-1',
      payload: { sku: 'I693-API-1', type: 'simple', name: 'Recreated', description: '', categoryIds: [], attributeValues: {}, visibility: 'public' },
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { data: { id: string } }).data.id).not.toBe(gone.id);
  });

  it('the read port\'s default lookup by SKU answers the live row', async () => {
    const { liveId } = await liveBesideDeleted('I693-READ-1');
    const port = cradle().catalogProductReadPort;

    expect((await port.findBySku('I693-READ-1'))?.id).toBe(liveId);
    expect((await port.findBySku('I693-READ-1', { liveOnly: true }))?.id).toBe(liveId);
    expect((await port.findBySkus(['I693-READ-1'])).map((p) => p.id)).toEqual([liveId]);

    // A SKU only a deleted row holds still resolves on the wide read: history needs it.
    const gone = await createProduct('I693-READ-GONE');
    await deleteProduct(gone.id);
    expect((await port.findBySku('I693-READ-GONE'))?.id).toBe(gone.id);
    expect(await port.findBySku('I693-READ-GONE', { liveOnly: true })).toBeNull();
  });

  it('findVariantsBySkus answers the live variant', async () => {
    const oldParent = await createProduct('I693-RV-OLD', 'configurable');
    expect(await createVariant(oldParent.id, 'I693-RV-1')).toBe(201);
    await deleteProduct(oldParent.id);
    const newParent = await createProduct('I693-RV-NEW', 'configurable');
    expect(await createVariant(newParent.id, 'I693-RV-1')).toBe(201);

    const found = await cradle().catalogProductReadPort.findVariantsBySkus(['I693-RV-1']);
    expect(found.map((v) => v.parentProductId)).toEqual([newParent.id]);
  });

  it('the bulk product import writes the live row', async () => {
    const { liveId, deletedId } = await liveBesideDeleted('I693-IMPORT-1');

    const report = await withSystemScope('issue 693 test — bulk import', () =>
      cradle().catalogBulkImportPort.importProducts([
        { sku: 'I693-IMPORT-1', cells: [{ scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Imported live' } }] },
      ]),
    );
    expect(report).toEqual({ imported: 1, errors: [] });

    const rows = (await h.em().getConnection().execute(
      `select "id", "name" from "products" where "id" in (?, ?)`,
      [liveId, deletedId],
    )) as Array<{ id: string; name: string }>;
    const nameOf = new Map(rows.map((r) => [r.id, r.name]));
    expect(nameOf.get(liveId)).toBe('Imported live');
    expect(nameOf.get(deletedId)).toBe('I693-IMPORT-1');
  });

  it('the CSV stock import writes the live row', async () => {
    const { liveId, deletedId } = await liveBesideDeleted('I693-STOCK-1');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/inventory/import',
      payload: { csv: 'sku,onHand\nI693-STOCK-1,17\n', warehouseId: DEFAULT_WAREHOUSE_ID },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { rowsApplied: number } }).data.rowsApplied).toBe(1);

    const levels = (await h.em().getConnection().execute(
      `select "product_id", "on_hand" from "stock_levels" where "product_id" in (?, ?) and "warehouse_id" = ?`,
      [liveId, deletedId, DEFAULT_WAREHOUSE_ID],
    )) as Array<{ product_id: string; on_hand: number }>;
    expect(levels).toEqual([{ product_id: liveId, on_hand: 17 }]);
  });
});
