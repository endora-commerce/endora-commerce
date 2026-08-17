import {
  productStatusWriteSchema,
  productVisibilitySchema,
  type BulkImportReport,
  type BulkImportRowError,
  type ProductImportRow,
} from '@b2b/contracts';
import type { ImportExportAdapter, ImportExportPorts } from '../adapter.js';

/**
 * Products import/export. The CSV is intentionally flat — multilingual
 * `name`/`description` collapse to a single locale column (defaults to
 * `en-US`). Power users who need full multi-locale round-trip should use the
 * JSON API directly.
 *
 * Feature 075 / D-74 — `catalog` owns the write. The two enum columns are
 * parsed against the **published** schemas rather than a private allow-list
 * this module kept: the old one still accepted `archived`, a status feature 032
 * renamed to `inactive` five months ago, and wrote it into a column no other
 * path can produce it in. `productStatusWriteSchema` is the interactive admin
 * API's own answer to a legacy `archived` write, so the two paths now agree.
 */
export function productsAdapter(ports: ImportExportPorts): ImportExportAdapter {
  return {
    name: 'products',
    owners: ['catalog'],
    exportHeader: [
      'id',
      'sku',
      'slug',
      'type',
      'status',
      'visibility',
      'name_en',
      'description_en',
    ] as const,

    async exportRows(): Promise<string[][]> {
      const rows = await ports.catalogProducts.listAll();
      return rows.map((p) => [
        p.id,
        p.sku,
        p.slug,
        p.type,
        p.status,
        p.visibility,
        p.name['en-US'] ?? '',
        p.description['en-US'] ?? '',
      ]);
    },

    importHeader: ['sku', 'status', 'visibility', 'name_en', 'description_en'] as const,

    async importRows(records): Promise<BulkImportReport> {
      const errors: BulkImportRowError[] = [];
      const rows: ProductImportRow[] = [];

      for (const [index, record] of records.entries()) {
        const sku = record['sku']?.trim();
        if (!sku) {
          errors.push({ index, reason: 'sku is required' });
          continue;
        }

        const row: ProductImportRow = { sku };

        const statusRaw = record['status']?.trim();
        if (statusRaw) {
          const parsed = productStatusWriteSchema.safeParse(statusRaw);
          if (!parsed.success) {
            errors.push({ index, reason: `invalid status: ${statusRaw}` });
            continue;
          }
          row.status = parsed.data;
        }

        const visibilityRaw = record['visibility']?.trim();
        if (visibilityRaw) {
          const parsed = productVisibilitySchema.safeParse(visibilityRaw);
          if (!parsed.success) {
            errors.push({ index, reason: `invalid visibility: ${visibilityRaw}` });
            continue;
          }
          row.visibility = parsed.data;
        }

        const nameEn = record['name_en'];
        if (nameEn !== undefined && nameEn !== '') row.name = { 'en-US': nameEn };
        const descEn = record['description_en'];
        if (descEn !== undefined && descEn !== '') row.description = { 'en-US': descEn };

        // The `type` field is intentionally not editable post-create — see the
        // FIELD_IMMUTABLE error code in catalog. Operators changing a product's
        // structural type should issue a delete + recreate via the API.
        rows.push(row);
      }

      if (errors.length > 0) return { imported: 0, errors };
      return ports.catalogBulkImport.importProducts(rows);
    },
  };
}
