import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';

/**
 * Issue #1624 — the admin products list filters by category, sales channel and
 * stock state, and "select all matching" (`resolve-ids`) narrows by exactly the
 * same filters. Without the second half a bulk edit or delete started from a
 * filtered list would act on products outside the filter.
 *
 * - `categoryId` keeps the products in that category or any descendant;
 * - `salesChannelId` keeps the products bound to that channel (Principle XII —
 *   through the kernel's membership accessor, never a hand-written join);
 * - `stock=low|out` uses the Inventory list's definitions: out is a managed
 *   product whose cumulative on-hand is 0 or less, low is a managed product with
 *   a threshold whose on-hand is above 0 and at or below it;
 * - a malformed value answers `400 VALIDATION_FAILED` naming the field;
 * - with `inventory` off the list says the stock filter is unavailable, and a
 *   stock filter is refused (`503 MODULE_DISABLED`) rather than ignored — an
 *   ignored filter would hand select-all the whole catalogue.
 *
 * Every row asserted on is this file's own, found through a per-run SKU in `q`.
 */
describe('admin products list — category, channel and stock filters (issue #1624)', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const run = randomUUID().slice(0, 8);
  const prefix = `FILT-${run}`;
  const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

  interface ListBody {
    data: Array<{ id: string }>;
    pagination: { total: number };
    stockFilterAvailable: boolean;
  }

  let categoryId: string;
  let childCategoryId: string;
  let vipChannelId: string;
  /** In the child category, bound to the VIP channel too, out of stock. */
  let outInChild: string;
  /** In the root category, low on stock. */
  let lowInRoot: string;
  /** No category, plenty of stock. */
  let plenty: string;
  /** Unmanaged stock at zero: never "out". */
  let unmanaged: string;

  async function createCategory(slug: string, parentCategoryId?: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/categories',
      ...admin,
      payload: { name: { en: slug }, slug, ...(parentCategoryId ? { parentCategoryId } : {}) },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function createProduct(suffix: string, categoryIds: string[]): Promise<string> {
    const sku = `${prefix}-${suffix}`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...admin,
      payload: {
        sku,
        type: 'simple',
        name: sku,
        description: 'desc',
        categoryIds,
        attributeValues: {},
        visibility: 'public',
        status: 'active',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function patchProduct(id: string, payload: Record<string, unknown>): Promise<void> {
    const res = await h.app.inject({ method: 'PATCH', url: `/api/v1/admin/catalog/products/${id}`, ...admin, payload });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function setOnHand(productId: string, onHand: number): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory/levels',
      ...admin,
      payload: { productId, warehouseId: DEFAULT_WAREHOUSE_ID, onHand },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function listRaw(query: string): Promise<{ statusCode: number; json: () => unknown }> {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products?pageSize=500&q=${prefix}${query ? `&${query}` : ''}`,
      ...admin,
    });
  }

  async function list(query: string): Promise<ListBody> {
    const res = await listRaw(query);
    expect(res.statusCode).toBe(200);
    return res.json() as ListBody;
  }

  async function resolveRaw(body: Record<string, unknown>): Promise<{ statusCode: number; json: () => unknown }> {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products/resolve-ids',
      ...admin,
      payload: { archived: 'exclude', q: prefix, ...body },
    });
  }

  async function resolve(body: Record<string, unknown>): Promise<string[]> {
    const res = await resolveRaw(body);
    expect(res.statusCode).toBe(200);
    return [...(res.json() as { data: { productIds: string[] } }).data.productIds].sort();
  }

  const ids = (body: ListBody): string[] => body.data.map((p) => p.id).sort();

  /** The list and the selection must agree, filter for filter. */
  async function expectBoth(
    query: string,
    body: Record<string, unknown>,
    expected: string[],
  ): Promise<void> {
    expect(ids(await list(query)), `list ?${query}`).toEqual([...expected].sort());
    expect(await resolve(body), `resolve-ids ${JSON.stringify(body)}`).toEqual([...expected].sort());
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    categoryId = await createCategory(`filt-${run}`);
    childCategoryId = await createCategory(`filt-${run}-child`, categoryId);

    outInChild = await createProduct('OUT', [childCategoryId]);
    lowInRoot = await createProduct('LOW', [categoryId]);
    plenty = await createProduct('PLENTY', []);
    unmanaged = await createProduct('UNMANAGED', []);

    await patchProduct(lowInRoot, { lowStockThreshold: 5 });
    await patchProduct(plenty, { lowStockThreshold: 5 });
    await patchProduct(unmanaged, { manageStock: false });
    await setOnHand(outInChild, 0);
    await setOnHand(lowInRoot, 3);
    await setOnHand(plenty, 50);
    await setOnHand(unmanaged, 0);

    // Every admin-created product lands in the default channel; one of them is
    // bound to the VIP channel as well, so a channel filter has something to narrow.
    const em = h.em();
    const vip = await em.findOne(SalesChannel, { code: 'pl_b2b_vip' });
    expect(vip, 'the harness seeds pl_b2b_vip').not.toBeNull();
    vipChannelId = vip!.id;
    await em
      .getConnection()
      .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
        vipChannelId,
        outInChild,
      ]);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists every one of this file\'s products with no narrowing filter, and offers the stock filter', async () => {
    const body = await list('');
    expect(ids(body)).toEqual([outInChild, lowInRoot, plenty, unmanaged].sort());
    expect(body.stockFilterAvailable).toBe(true);
  });

  it('categoryId keeps the category and its descendants, in the list and in the selection', async () => {
    await expectBoth(`categoryId=${categoryId}`, { categoryId }, [outInChild, lowInRoot]);
    await expectBoth(`categoryId=${childCategoryId}`, { categoryId: childCategoryId }, [outInChild]);
  });

  it('an unknown category matches nothing rather than everything', async () => {
    const missing = randomUUID();
    await expectBoth(`categoryId=${missing}`, { categoryId: missing }, []);
  });

  it('salesChannelId keeps the products bound to that channel', async () => {
    await expectBoth(`salesChannelId=${vipChannelId}`, { salesChannelId: vipChannelId }, [outInChild]);
  });

  it('stock=out and stock=low follow the Inventory list\'s definitions', async () => {
    await expectBoth('stock=out', { stock: 'out' }, [outInChild]);
    await expectBoth('stock=low', { stock: 'low' }, [lowInRoot]);
  });

  it('the filters combine', async () => {
    await expectBoth(`categoryId=${categoryId}&stock=low`, { categoryId, stock: 'low' }, [lowInRoot]);
    await expectBoth(
      `categoryId=${categoryId}&salesChannelId=${vipChannelId}&stock=low`,
      { categoryId, salesChannelId: vipChannelId, stock: 'low' },
      [],
    );
  });

  it.each([
    ['categoryId', 'categoryId=not-a-uuid', { categoryId: 'not-a-uuid' }],
    ['salesChannelId', 'salesChannelId=not-a-uuid', { salesChannelId: 'not-a-uuid' }],
    ['stock', 'stock=high', { stock: 'high' }],
  ])('a malformed %s answers 400 VALIDATION_FAILED', async (field, query, body) => {
    const listRes = await listRaw(query);
    expect(listRes.statusCode).toBe(400);
    const listError = (listRes.json() as { error: { code: string; details?: { field?: string } } }).error;
    expect(listError.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(listError.details?.field).toBe(field);

    const resolveRes = await resolveRaw(body);
    expect(resolveRes.statusCode).toBe(400);
  });

  it('with inventory off the stock filter is unavailable and refused, never ignored', async () => {
    await withModuleOff('inventory', 'platform-unavailable', async () => {
      const body = await list('');
      expect(body.stockFilterAvailable).toBe(false);
      expect(ids(body)).toEqual([outInChild, lowInRoot, plenty, unmanaged].sort());

      const listRes = await listRaw('stock=out');
      expect(listRes.statusCode).toBe(503);
      expect((listRes.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.MODULE_DISABLED);

      const resolveRes = await resolveRaw({ stock: 'out' });
      expect(resolveRes.statusCode).toBe(503);
      expect((resolveRes.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    });
  });
});
