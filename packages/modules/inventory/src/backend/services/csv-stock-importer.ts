import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductReadPort,
  StockImportError,
  StockImportResult,
} from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import { randomUUID } from 'crypto';
import { StockLevel } from '../entities/stock-level.entity.js';
import { Warehouse } from '../entities/warehouse.entity.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { InventoryAuditContext } from '../plugin.js';

export interface CsvImportInput {
  csv: string;
  warehouseId: string;
  dryRun?: boolean;
  /** Optional original filename — surfaces in the audit row summary. */
  fileName?: string | null;
}

/**
 * CSV stock importer (US7 / FR-031).
 *
 * Accepts a CSV with a `sku,onHand` header row and applies the on-hand
 * value for each product *into the chosen warehouse*. The format is:
 *
 *   sku,onHand
 *   PRD-001,42
 *   PRD-002,0
 *
 * Rows whose SKU does not resolve to a Product produce a
 * `product_not_found` error. Negative or non-integer onHand values
 * produce `invalid_quantity`. Malformed rows (wrong column count, no
 * comma) produce `malformed_row`. The function returns a summary for
 * the operator UI; the file itself is never persisted.
 *
 * Implementation note (research §R8): Node-native streaming + manual
 * row split keeps the dep graph minimal. The XLSX path lives in a
 * sibling file and uses `read-excel-file` (selected per T003).
 */
export class CsvStockImporter {
  constructor(
    private readonly emFactory: () => EntityManager,
    /**
     * `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). A
     * sheet addresses a product by SKU, so somebody has to ask `catalog`; the
     * `product_not_found` row error is raised from its answer.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly eventBus?: EventBus,
    private readonly auditLog?: AuditPort,
  ) {}

  async run(
    input: CsvImportInput,
    auditCtx?: InventoryAuditContext,
  ): Promise<StockImportResult> {
    const lines = input.csv.split(/\r?\n/);
    const errors: StockImportError[] = [];
    let rowsRead = 0;
    let rowsApplied = 0;
    let rowsSkipped = 0;

    if (lines.length === 0) {
      return { rowsRead: 0, rowsApplied: 0, rowsSkipped: 0, errors };
    }

    const header = (lines[0] ?? '').split(',').map((c) => c.trim().toLowerCase());
    const skuIdx = header.indexOf('sku');
    const onHandIdx = header.indexOf('onhand');
    if (skuIdx === -1 || onHandIdx === -1) {
      return {
        rowsRead: 0,
        rowsApplied: 0,
        rowsSkipped: 0,
        errors: [
          {
            row: 1,
            sku: '',
            reason: 'malformed_row',
          },
        ],
      };
    }

    const em = this.emFactory();
    const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);
    rowsRead = dataLines.length;

    for (let i = 0; i < dataLines.length; i++) {
      const lineNo = i + 2;
      const cells = (dataLines[i] ?? '').split(',').map((c) => c.trim());
      if (cells.length < Math.max(skuIdx, onHandIdx) + 1) {
        errors.push({ row: lineNo, sku: '', reason: 'malformed_row' });
        rowsSkipped += 1;
        continue;
      }
      const sku = cells[skuIdx] ?? '';
      const onHandRaw = cells[onHandIdx] ?? '';
      const onHand = Number.parseInt(onHandRaw, 10);
      if (!Number.isFinite(onHand) || onHand < 0 || String(onHand) !== onHandRaw) {
        errors.push({ row: lineNo, sku, reason: 'invalid_quantity' });
        rowsSkipped += 1;
        continue;
      }

      const product = await this.catalogProducts.findBySku(sku);
      if (!product) {
        errors.push({ row: lineNo, sku, reason: 'product_not_found' });
        rowsSkipped += 1;
        continue;
      }

      if (input.dryRun) {
        rowsApplied += 1;
        continue;
      }

      let row = await em.findOne(StockLevel, {
        productId: product.id,
        warehouseId: input.warehouseId,
        variantId: null,
      });
      const before = row?.onHand ?? 0;
      if (row) {
        row.onHand = onHand;
      } else {
        row = em.create(StockLevel, {
          productId: product.id,
          warehouseId: input.warehouseId,
          onHand,
        });
      }
      await em.persistAndFlush(row);
      rowsApplied += 1;

      if (this.eventBus && before !== onHand) {
        this.eventBus.emit('inventory.adjusted.v1', {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          productId: product.id,
          warehouseId: input.warehouseId,
          variantId: null,
          before,
          after: onHand,
        } as never);
      }
    }

    // Feature 024 — single summary audit row per CSV import, never per
    // CSV line. Dry runs are not audited (no state changed).
    if (this.auditLog && auditCtx && !input.dryRun && rowsApplied > 0) {
      const warehouse = await em.findOne(Warehouse, { id: input.warehouseId });
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'stock_level.bulk_import',
        objectType: 'bulk_operation',
        objectId: randomUUID(),
        stateAfter: {
          warehouseId: input.warehouseId,
          warehouseCode: warehouse?.code ?? null,
          fileName: input.fileName ?? null,
          rowsProcessed: rowsApplied,
          rowsSkipped,
          rowsErrored: errors.length,
        },
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }

    return { rowsRead, rowsApplied, rowsSkipped, errors };
  }
}
