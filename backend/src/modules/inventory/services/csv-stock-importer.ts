import type { EntityManager } from '@mikro-orm/postgresql';
import type { StockImportError, StockImportResult } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import { randomUUID } from 'crypto';
import { Product } from '../../catalog/entities/product.entity.js';
import { StockLevel } from '../entities/stock-level.entity.js';

export interface CsvImportInput {
  csv: string;
  warehouseId: string;
  dryRun?: boolean;
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
    private readonly eventBus?: EventBus,
  ) {}

  async run(input: CsvImportInput): Promise<StockImportResult> {
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

      const product = await em.findOne(Product, { sku });
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

    return { rowsRead, rowsApplied, rowsSkipped, errors };
  }
}
