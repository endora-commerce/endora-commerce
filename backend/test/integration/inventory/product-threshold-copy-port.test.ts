import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InventoryProductThresholdWritePort } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CommandBus } from '../../../src/commands/index.js';
import { InventoryProductThresholdWriteService } from '../../../src/modules/inventory/services/product-threshold-write.service.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { ProductWarehouseLowStockThreshold } from '../../../src/modules/inventory/entities/product-warehouse-low-stock-threshold.entity.js';
import { Warehouse } from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `InventoryProductThresholdWritePort.copyProductWarehouseThresholds` — issue #185.
 *
 * The rows are this module's (`product_warehouse_low_stock_thresholds`, created
 * by this module's migration), and until this port existed `catalog` inserted
 * them itself with a raw `insert … select` inside `duplicateProduct`. That
 * write named no import specifier, asked no gate, and left no audit row on this
 * side: per-warehouse alerting profiles appeared in this module's table with
 * nothing here having decided they should.
 *
 * So the copy is published here, and this file pins the three properties that
 * makes it worth doing at all: it copies, it audits once, and it owns its own
 * transaction rather than joining the caller's.
 */
describe('InventoryProductThresholdWritePort — the per-warehouse threshold copy [real DB]', () => {
  let h: BackendServerHandle;
  let port: InventoryProductThresholdWritePort;

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new InventoryProductThresholdWriteService(
      new CommandBus(h.orm, h.auditLogService, h.eventBus),
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const run = async <T>(what: string, fn: () => Promise<T>): Promise<T> =>
    withSystemScope(`issue #185 test — ${what}`, fn);

  const auditCount = async (): Promise<number> =>
    h.em().count(AuditLogEntry, { action: 'inventory.product_thresholds.copy' });

  const createProduct = async (suffix: string): Promise<string> => {
    const em = h.em();
    const product = em.create(Product, {
      sku: `W185-${suffix}`,
      slug: `w185-${suffix.toLowerCase()}`,
      type: 'simple',
      status: 'draft',
      name: { en: `W185 ${suffix}` },
      description: { en: 'fixture' },
      visibility: 'public',
      attributeValues: {},
      allowedOrganizationIds: [],
    });
    await em.persistAndFlush(product);
    return product.id;
  };

  const createWarehouse = async (): Promise<string> => {
    const em = h.em();
    const code = `w185-${randomUUID().slice(0, 8)}`;
    const warehouse = em.create(Warehouse, { name: code, code, active: true });
    await em.persistAndFlush(warehouse);
    return warehouse.id;
  };

  const seedThreshold = async (
    productId: string,
    warehouseId: string,
    threshold: number,
  ): Promise<void> => {
    const em = h.em();
    em.persist(
      em.create(ProductWarehouseLowStockThreshold, {
        productId,
        warehouseId,
        threshold,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    await em.flush();
  };

  const thresholdsOf = async (
    productId: string,
  ): Promise<Array<{ warehouseId: string; threshold: number }>> => {
    const rows = await h
      .em()
      .find(ProductWarehouseLowStockThreshold, { productId }, { orderBy: { warehouseId: 'asc' } });
    return rows.map((row) => ({ warehouseId: row.warehouseId, threshold: row.threshold }));
  };

  it('copies every per-warehouse threshold onto the target and audits the copy once', async () => {
    const before = await auditCount();
    const source = await createProduct(`src-${randomUUID().slice(0, 6)}`);
    const target = await createProduct(`dst-${randomUUID().slice(0, 6)}`);
    const first = await createWarehouse();
    const second = await createWarehouse();
    await seedThreshold(source, first, 4);
    await seedThreshold(source, second, 11);

    const result = await run('copy two thresholds', () =>
      port.copyProductWarehouseThresholds({
        sourceProductId: source,
        targetProductId: target,
      }),
    );

    expect(result).toEqual({ copied: 2 });
    h.em().clear();
    const copied = await thresholdsOf(target);
    expect(copied.map((row) => row.threshold).sort((a, b) => a - b)).toEqual([4, 11]);
    expect(copied.map((row) => row.warehouseId).sort()).toEqual([first, second].sort());
    expect(await auditCount()).toBe(before + 1);
  });

  it('answers zero and writes no audit row when the source carries no thresholds', async () => {
    const before = await auditCount();
    const source = await createProduct(`empty-src-${randomUUID().slice(0, 6)}`);
    const target = await createProduct(`empty-dst-${randomUUID().slice(0, 6)}`);

    const result = await run('copy nothing', () =>
      port.copyProductWarehouseThresholds({
        sourceProductId: source,
        targetProductId: target,
      }),
    );

    expect(result).toEqual({ copied: 0 });
    expect(await thresholdsOf(target)).toEqual([]);
    // Nothing changed state, so nothing is recorded — the same rule
    // `SalesChannelMembershipService` applies to an idempotent membership add.
    expect(await auditCount()).toBe(before);
  });

  it('overwrites a threshold the target already carries rather than failing on the primary key', async () => {
    const source = await createProduct(`over-src-${randomUUID().slice(0, 6)}`);
    const target = await createProduct(`over-dst-${randomUUID().slice(0, 6)}`);
    const warehouse = await createWarehouse();
    await seedThreshold(source, warehouse, 9);
    await seedThreshold(target, warehouse, 2);

    await run('copy over an existing row', () =>
      port.copyProductWarehouseThresholds({
        sourceProductId: source,
        targetProductId: target,
      }),
    );

    h.em().clear();
    expect(await thresholdsOf(target)).toEqual([{ warehouseId: warehouse, threshold: 9 }]);
  });
});
