import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Admin inventory stock-level routes — feature 010 US2 contract.
 *
 * Replaces the foundation 001 single-bucket test. The new surface is:
 *   - GET  /api/v1/admin/inventory          → landing KPIs
 *   - GET  /api/v1/admin/inventory/levels   → per-product roster
 *   - PUT  /api/v1/admin/inventory/levels   → setOnHand for (product, warehouse)
 *
 * The foundation backward-compat single-bucket PUT (`PUT /api/v1/admin/inventory`)
 * is kept and lives behind `setLegacyStockLevelSchema`; covered by
 * `legacy-stock-audit.test.ts`. That citation used to name `legacy-stock.test.ts`,
 * a file which has never existed — the surface was documented as covered while
 * nothing exercised it (issue #125).
 */
const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

describe('Admin inventory stock-level routes (feature 010 US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns landing KPIs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        totalProductsTracked: number;
        totalOnHand: number;
        outOfStockCount: number;
        lowStockCount: number;
        perWarehouseTotals: Array<{ warehouseId: string; warehouseCode: string; onHand: number }>;
      };
    };
    expect(body.data).toBeTruthy();
    expect(body.data.perWarehouseTotals.some((t) => t.warehouseCode === 'default')).toBe(true);
  });

  it('lists per-product roster filtered by productId', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/inventory/levels?productId=${SEED_PRODUCT_101_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{
        productId: string;
        cumulativeOnHand: number;
        perWarehouse: Array<{ warehouseId: string; onHand: number }>;
      }>;
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.productId).toBe(SEED_PRODUCT_101_ID);
  });

  it('sets an absolute on-hand value for (product, warehouse)', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory/levels',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        productId: SEED_PRODUCT_101_ID,
        warehouseId: DEFAULT_WAREHOUSE_ID,
        onHand: 250,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { after: number; productId: string; warehouseId: string };
    };
    expect(body.data.after).toBe(250);
    expect(body.data.productId).toBe(SEED_PRODUCT_101_ID);
    expect(body.data.warehouseId).toBe(DEFAULT_WAREHOUSE_ID);
  });
});
