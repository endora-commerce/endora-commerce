import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

/**
 * Per-(product, warehouse) low-stock thresholds:
 *  - PUT /admin/inventory/warehouse-low-stock-thresholds upserts entries
 *    (and clears them when threshold=null).
 *  - GET /admin/inventory/levels surfaces the resolved value per warehouse
 *    on every roster row.
 *  - With the product in per_warehouse mode and on-hand at/below the
 *    threshold, the roster's top-level `isLowStock` flag is true.
 */
describe('Admin per-(product, warehouse) low-stock thresholds', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('upserts thresholds, surfaces them on the roster, and flags low-stock', async () => {
    // Seed: ensure on-hand for the default warehouse is 2 (deterministic for the assertion).
    const setOnHand = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory/levels',
      payload: {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        onHand: 2,
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(setOnHand.statusCode).toBe(200);

    // Switch the product to per-warehouse mode.
    const switchMode = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${SEED_PRODUCT_101_ID}`,
      payload: { lowStockThresholdMode: 'per_warehouse' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(switchMode.statusCode).toBe(200);

    // Set a per-warehouse threshold of 5 on the Default warehouse.
    const upsert = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory/warehouse-low-stock-thresholds',
      payload: {
        productId: SEED_PRODUCT_101_ID,
        thresholds: [
          { warehouseId: DEFAULT_WAREHOUSE_ID, threshold: 5 },
        ],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(upsert.statusCode).toBe(204);

    // Roster surfaces the threshold + flags isLowStock (on-hand 2 ≤ threshold 5).
    const rosterRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/inventory/levels?productId=${SEED_PRODUCT_101_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(rosterRes.statusCode).toBe(200);
    const rosterBody = rosterRes.json() as {
      items: Array<{
        lowStockThresholdMode: string;
        isLowStock: boolean;
        perWarehouse: Array<{
          warehouseId: string;
          lowStockThreshold: number | null;
        }>;
      }>;
    };
    const row = rosterBody.items[0]!;
    expect(row.lowStockThresholdMode).toBe('per_warehouse');
    expect(row.isLowStock).toBe(true);
    const defaultRow = row.perWarehouse.find(
      (pw) => pw.warehouseId === DEFAULT_WAREHOUSE_ID,
    );
    expect(defaultRow?.lowStockThreshold).toBe(5);

    // Clear the threshold by sending threshold=null.
    const clear = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory/warehouse-low-stock-thresholds',
      payload: {
        productId: SEED_PRODUCT_101_ID,
        thresholds: [{ warehouseId: DEFAULT_WAREHOUSE_ID, threshold: null }],
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(clear.statusCode).toBe(204);

    const rosterAfterClear = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/inventory/levels?productId=${SEED_PRODUCT_101_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const afterRow = (rosterAfterClear.json() as {
      items: Array<{
        isLowStock: boolean;
        perWarehouse: Array<{
          warehouseId: string;
          lowStockThreshold: number | null;
        }>;
      }>;
    }).items[0]!;
    const defAfter = afterRow.perWarehouse.find(
      (pw) => pw.warehouseId === DEFAULT_WAREHOUSE_ID,
    );
    // After clear, the resolved threshold falls back to the warehouse default
    // (null unless an operator set one; the seeded Default warehouse has no
    // default in the seed, so the row drops to null and isLowStock=false).
    expect(defAfter?.lowStockThreshold ?? null).toBeNull();
    expect(afterRow.isLowStock).toBe(false);
  });
});
