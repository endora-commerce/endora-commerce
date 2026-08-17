import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CommandBus } from '../../../src/commands/index.js';
import { InventoryStockImportService } from '../../../src/modules/inventory/services/stock-import.service.js';
import { CatalogProductReadService } from '../../../src/modules/catalog/services/catalog-product-read.service.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { StockLevel } from '../../../src/modules/inventory/entities/stock-level.entity.js';
import { DEFAULT_WAREHOUSE_ID } from '../../../src/modules/inventory/entities/warehouse.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Feature 075 / D-74 — the stock half of the bulk import.
 *
 * The rows are `stock_levels`, and `import_export` was writing them while
 * declaring `catalog` and `auth` as its only dependencies — an edge no check in
 * the tree could see. It addressed the seeded warehouse by a **copy** of this
 * module's deterministic UUID, pasted into a function body, which
 * `check:module-boundary` is structurally unable to report because it reads
 * import specifiers. Both come back here with the write.
 */
describe('InventoryStockImportService — one Command per run [real DB]', () => {
  let h: BackendServerHandle;
  let service: InventoryStockImportService;

  beforeAll(async () => {
    h = await setupBackendServer();
    const commandBus = new CommandBus(h.orm, h.auditLogService, h.eventBus);
    service = new InventoryStockImportService(commandBus, new CatalogProductReadService(h.em));
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const run = async <T>(what: string, fn: () => Promise<T>): Promise<T> =>
    withSystemScope(`feature 075 D-74 test — ${what}`, fn);

  const auditCount = async (): Promise<number> =>
    h.em().count(AuditLogEntry, { action: 'inventory.stock_levels.import' });

  it('applies a run into the seeded default warehouse and audits it once', async () => {
    const before = await auditCount();

    const report = await run('valid stock run', () =>
      service.importStockLevels([{ productSku: 'EXAMPLE-SIMPLE-001', onHand: 41 }]),
    );

    expect(report).toEqual({ imported: 1, errors: [] });
    const product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    const level = await h.em().findOneOrFail(StockLevel, {
      productId: product.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(level.onHand).toBe(41);
    expect(await auditCount()).toBe(before + 1);
  });

  it('updates the level a previous run created rather than inserting a second one', async () => {
    await run('second stock run', () =>
      service.importStockLevels([{ productSku: 'EXAMPLE-SIMPLE-001', onHand: 7 }]),
    );

    const product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    const levels = await h.em().find(StockLevel, {
      productId: product.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(levels).toHaveLength(1);
    expect(levels[0]?.onHand).toBe(7);
  });

  it('refuses the whole run when one SKU does not resolve, and audits nothing', async () => {
    const product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    const beforeAudit = await auditCount();
    const beforeLevel = await h.em().findOneOrFail(StockLevel, {
      productId: product.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    const beforeOnHand = beforeLevel.onHand;

    const report = await run('unknown sku', () =>
      service.importStockLevels([
        { productSku: 'EXAMPLE-SIMPLE-001', onHand: 999 },
        { productSku: 'SI-NO-SUCH-SKU', onHand: 1 },
      ]),
    );

    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([{ index: 1, reason: 'unknown product_sku: SI-NO-SUCH-SKU' }]);
    const reloaded = await h.em().findOneOrFail(StockLevel, {
      productId: product.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
      variantId: null,
    });
    expect(reloaded.onHand).toBe(beforeOnHand);
    expect(await auditCount()).toBe(beforeAudit);
  });

  it('audits nothing for an empty run', async () => {
    const before = await auditCount();
    expect(await run('empty stock run', () => service.importStockLevels([]))).toEqual({
      imported: 0,
      errors: [],
    });
    expect(await auditCount()).toBe(before);
  });
});
