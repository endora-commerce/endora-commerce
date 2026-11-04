import {
  ERROR_CODES,
  parseScopedStatusColumn,
  productScopeStatusSchema,
  productStatusSchema,
  scopedStatusColumn,
  productVisibilitySchema,
  type BulkImportReport,
  type BulkImportRowError,
  type CatalogProductRecord,
  type ProductImportRow,
  type ScopedStatusCell,
} from '@endora-commerce/contracts';
import type { ImportExportAdapter, ImportExportPorts } from '../adapter.js';

/**
 * Products import/export. The CSV is intentionally flat — multilingual
 * `name`/`description` collapse to a single locale column (defaults to
 * `en-US`). Power users who need full multi-locale round-trip should use the
 * JSON API directly.
 *
 * Feature 075 / D-74 — `catalog` owns the write. The two enum columns are
 * parsed against the **published** schemas rather than a private allow-list
 * this module kept, so this path and the interactive admin API agree.
 * Feature 163 (FR-092, FR-112) — the status is `active` | `inactive`: `draft` and
 * the legacy `archived` alias are refused per record like any unknown value, and
 * `inactive` switches a product off without archiving it (archiving is its own
 * action, never a status).
 */
const IMPORT_HEADER = ['sku', 'status', 'visibility', 'name_en', 'description_en'] as const;

/**
 * Feature 172 (FR-041 import) — the keys of the Page Builder content attributes
 * among a file's columns. Asked of `catalog` once per import, and only when the
 * file carries a column this adapter does not read itself: a document is never
 * an importable cell, whatever its column is called.
 */
async function contentColumnsOf(
  ports: ImportExportPorts,
  records: ReadonlyArray<Record<string, string>>,
): Promise<string[]> {
  const known = new Set<string>(IMPORT_HEADER);
  const foreign = new Set<string>();
  for (const record of records) {
    for (const column of Object.keys(record)) {
      if (!known.has(column) && parseScopedStatusColumn(column) === null) foreign.add(column);
    }
  }
  if (foreign.size === 0) return [];
  const contentKeys = await ports.catalogBulkImport.contentAttributeKeys();
  return contentKeys.filter((key) => foreign.has(key));
}

const EXPORT_HEADER = [
  'id',
  'sku',
  'slug',
  'type',
  'status',
  'visibility',
  'name_en',
  'description_en',
] as const;

function exportRowOf(p: CatalogProductRecord): string[] {
  return [
    p.id,
    p.sku,
    p.slug,
    p.type,
    p.status,
    p.visibility,
    p.name['en-US'] ?? '',
    p.description['en-US'] ?? '',
  ];
}

export function productsAdapter(ports: ImportExportPorts): ImportExportAdapter {
  return {
    name: 'products',
    owners: ['catalog'],
    exportPermission: 'catalog:read',
    importPermission: 'catalog:write',
    exportHeader: EXPORT_HEADER,

    // Feature 163 (FR-092) — the fixed columns, then one `status@<channel code>` and
    // one `status@<channel code>/<language>` column per scope: the override there,
    // empty where the scope inherits. Importing the file unchanged changes nothing.
    async exportTable() {
      const [products, scoped] = await Promise.all([
        ports.catalogProducts.listAll(),
        ports.catalogBulkImport.exportScopedStatuses(),
      ]);
      const columns = scoped.columns.map((c) => scopedStatusColumn(c.channelCode, c.languageCode));
      return {
        header: [...EXPORT_HEADER, ...columns],
        rows: products.map((p) => {
          const values = scoped.values[p.id] ?? {};
          return [...exportRowOf(p), ...columns.map((column) => values[column] ?? '')];
        }),
      };
    },

    async exportRows(): Promise<string[][]> {
      return (await ports.catalogProducts.listAll()).map(exportRowOf);
    },

    importHeader: IMPORT_HEADER,
    // Feature 160 (FR-043) — a product has no price of its own; prices are set
    // in price books. A file still carrying a price column is refused rather
    // than imported without it.
    refusedHeader: ['default_price', 'defaultPrice', 'price', 'price_override', 'priceOverride'].map((column) => ({
      column,
      code: ERROR_CODES.PRICE_SET_IN_PRICE_BOOKS,
      message: 'Prices are set in price books, not on the product: remove the price column.',
    })),

    async importRows(records): Promise<BulkImportReport> {
      const errors: BulkImportRowError[] = [];
      const rows: ProductImportRow[] = [];
      const contentColumns = await contentColumnsOf(ports, records);

      for (const [index, record] of records.entries()) {
        // Feature 172 (FR-041, research R-20 (3)) — a value under a content
        // attribute's column is refused per row, naming the attribute; the
        // row's other cells are still validated below, so every problem shows
        // at once. The file is then not imported, as with any row error.
        for (const key of contentColumns) {
          if ((record[key] ?? '').trim() !== '') {
            errors.push({ index, reason: `content attribute "${key}" cannot be imported` });
          }
        }

        const sku = record['sku']?.trim();
        if (!sku) {
          errors.push({ index, reason: 'sku is required' });
          continue;
        }

        const row: ProductImportRow = { sku };

        const statusRaw = record['status']?.trim();
        if (statusRaw) {
          const parsed = productStatusSchema.safeParse(statusRaw);
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

        // Feature 163 (FR-092) — `status@<channel code>[/<language>]` cells. An empty
        // cell is "use inherited"; a scope the file has no column for is untouched.
        // The value is read against the contract's own status list.
        const scopedStatus: ScopedStatusCell[] = [];
        let scopedInvalid = false;
        for (const [column, raw] of Object.entries(record)) {
          const scope = parseScopedStatusColumn(column);
          if (scope === null) continue;
          const value = raw.trim();
          if (value === '') {
            scopedStatus.push({ ...scope, status: null });
            continue;
          }
          const parsed = productScopeStatusSchema.safeParse(value);
          if (!parsed.success) {
            errors.push({ index, reason: `invalid ${column.trim()}: ${value}` });
            scopedInvalid = true;
            break;
          }
          scopedStatus.push({ ...scope, status: parsed.data });
        }
        if (scopedInvalid) continue;
        if (scopedStatus.length > 0) row.scopedStatus = scopedStatus;

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
