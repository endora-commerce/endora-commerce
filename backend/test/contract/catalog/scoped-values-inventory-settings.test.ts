import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 180, WP-4 (FR-025, owner ruling OQ-7 = B; research R22) — the product Inventory tab's
 * product-row settings travel in the editor's one Save, `PUT …/scoped-values` at Global, in its
 * `changes.product` family. This holds that the write carries all six columns, that the read
 * answers them back, and that the save is one audited Command naming them.
 */
describe('180 WP-4 — the Inventory tab settings in the scoped save', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('writes stock management, backorders, the threshold and its mode, and the fulfilment strategy at Global', async () => {
    const id = await fx.product({});
    const warehouseOrder = ['00000000-0000-4000-8000-0000001800a1'];
    const saved = await fx.save(id, {}, {
      product: {
        manageStock: false,
        backorderEnabled: true,
        lowStockThreshold: 4,
        lowStockThresholdMode: 'per_warehouse',
        fulfilmentStrategy: 'defined_order',
        fulfilmentStrategyWarehouseOrder: warehouseOrder,
      },
    });
    expect(saved.product).toMatchObject({
      manageStock: false,
      backorderEnabled: true,
      lowStockThreshold: 4,
      lowStockThresholdMode: 'per_warehouse',
      fulfilmentStrategy: 'defined_order',
      fulfilmentStrategyWarehouseOrder: warehouseOrder,
    });
    const reread = await fx.read(id);
    expect(reread.product.lowStockThreshold).toBe(4);

    const entries = await fx.sql<{ state_after: Record<string, unknown> }>(
      `select state_after from audit_log_entries where action = 'product.scoped_values.save' and object_id = ?`,
      [id],
    );
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]!.state_after['cells'] as Record<string, unknown>).sort()).toEqual(
      [
        'product.backorderEnabled@G',
        'product.fulfilmentStrategy@G',
        'product.fulfilmentStrategyWarehouseOrder@G',
        'product.lowStockThreshold@G',
        'product.lowStockThresholdMode@G',
        'product.manageStock@G',
      ].sort(),
    );
  });

  it('clears the threshold and the strategy with null', async () => {
    const id = await fx.product({});
    await fx.save(id, {}, { product: { lowStockThreshold: 3, fulfilmentStrategy: 'any' } });
    const saved = await fx.save(id, {}, { product: { lowStockThreshold: null, fulfilmentStrategy: null } });
    expect(saved.product.lowStockThreshold).toBeNull();
    expect(saved.product.fulfilmentStrategy).toBeNull();
  });
});
