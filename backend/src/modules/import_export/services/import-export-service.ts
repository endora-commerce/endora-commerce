import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { parseCsv, rowsToRecords, serializeCsv } from './csv-codec.js';
import type { ImportExportAdapter } from './adapter.js';
import { productsAdapter } from './adapters/products.adapter.js';
import { categoriesAdapter } from './adapters/categories.adapter.js';
import { stockAdapter } from './adapters/stock.adapter.js';
import { customersAdapter } from './adapters/customers.adapter.js';
import { ordersAdapter } from './adapters/orders.adapter.js';

/**
 * ImportExportService — adapter dispatcher.
 *
 * Each entity has a single source of truth (the adapter), keeping the
 * route layer free of per-entity branches. Import is run inside a single
 * transaction so a partial failure leaves no rows behind.
 */

const ADAPTERS: Record<string, ImportExportAdapter> = {
  products: productsAdapter,
  categories: categoriesAdapter,
  stock: stockAdapter,
  customers: customersAdapter,
  orders: ordersAdapter,
};

export const SUPPORTED_EXPORT_ENTITIES = Object.keys(ADAPTERS);
export const SUPPORTED_IMPORT_ENTITIES = Object.values(ADAPTERS)
  .filter((a) => a.importHeader && a.importRow)
  .map((a) => a.name);

export interface ImportReport {
  imported: number;
  errors: Array<{ rowNumber: number; reason: string }>;
}

export class ImportExportService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async exportToCsv(entity: string): Promise<string> {
    const adapter = this.adapterFor(entity);
    const rows = await adapter.exportRows(this.emFactory());
    return serializeCsv([Array.from(adapter.exportHeader), ...rows]);
  }

  /**
   * Apply a CSV file. Either every row lands or none — the whole import
   * runs inside one transaction. Per-row validation errors are collected
   * and returned; the presence of any error rolls the transaction back so
   * the operator can fix the spreadsheet and re-upload deterministically.
   */
  async importFromCsv(entity: string, csv: string): Promise<ImportReport> {
    const adapter = this.adapterFor(entity);
    if (!adapter.importHeader || !adapter.importRow) {
      throw new HttpError(
        405,
        ERROR_CODES.VALIDATION_FAILED,
        `Import is not supported for "${entity}".`,
      );
    }

    let parsed: string[][];
    try {
      parsed = parseCsv(csv);
    } catch (err) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        err instanceof Error ? err.message : 'Failed to parse CSV.',
      );
    }
    if (parsed.length === 0) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'CSV is empty.');
    }
    const rawHeader = parsed[0]!.map((h) => h.trim());
    for (const required of adapter.importHeader) {
      if (!rawHeader.includes(required)) {
        throw new HttpError(
          400,
          ERROR_CODES.VALIDATION_FAILED,
          `Missing required header column: ${required}`,
        );
      }
    }

    const records = rowsToRecords(parsed);

    const em = this.emFactory();
    const errors: ImportReport['errors'] = [];
    let imported = 0;
    await em.transactional(async (txEm) => {
      for (let i = 0; i < records.length; i++) {
        const result = await adapter.importRow!(txEm, records[i]!);
        if (result.ok) {
          imported += 1;
        } else {
          // Row numbers are 1-based and exclude the header line, matching
          // what spreadsheet apps display.
          errors.push({ rowNumber: i + 2, reason: result.reason ?? 'rejected' });
        }
      }
      if (errors.length > 0) {
        // Roll back by throwing — caller surfaces the report.
        throw new ImportFailed();
      }
    }).catch((err) => {
      if (err instanceof ImportFailed) return;
      throw err;
    });

    return errors.length > 0 ? { imported: 0, errors } : { imported, errors: [] };
  }

  exportHeaderFor(entity: string): readonly string[] {
    return this.adapterFor(entity).exportHeader;
  }

  importHeaderFor(entity: string): readonly string[] | undefined {
    return this.adapterFor(entity).importHeader;
  }

  private adapterFor(entity: string): ImportExportAdapter {
    const adapter = ADAPTERS[entity];
    if (!adapter) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Unknown import/export entity "${entity}". Supported: ${Object.keys(ADAPTERS).join(', ')}.`,
      );
    }
    return adapter;
  }
}

class ImportFailed extends Error {
  constructor() {
    super('import contained validation errors');
  }
}
