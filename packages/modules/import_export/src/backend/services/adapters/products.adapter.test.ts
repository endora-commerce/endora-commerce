import { describe, expect, it, vi } from 'vitest';
import type { CatalogProductRecord, ProductImportRow, ScopedStatusExport } from '@endora-commerce/contracts';
import type { ImportExportPorts } from '../adapter.js';
import { productsAdapter } from './products.adapter.js';

/**
 * Feature 163 (FR-092, FR-112, spec Session 2026-10-25 O-1) — an imported status is
 * `active` or `inactive`. `draft` no longer exists and the legacy `archived` alias is
 * refused per record rather than mapped: archiving is its own action, not a status.
 */
function adapterWith(importProducts = vi.fn(async () => ({ imported: 1, errors: [] }))) {
  const ports = { catalogBulkImport: { importProducts } } as unknown as ImportExportPorts;
  const adapter = productsAdapter(ports);
  const importRows = adapter.importRows?.bind(adapter);
  if (!importRows) throw new Error('the products adapter imports');
  return { importRows, importProducts };
}

describe('products adapter — status column (FR-092)', () => {
  it.each(['draft', 'archived'])('refuses %s per record with invalid status', async (status) => {
    const { importRows, importProducts } = adapterWith();
    const report = await importRows([{ sku: 'A', status }]);
    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([{ index: 0, reason: `invalid status: ${status}` }]);
    expect(importProducts).not.toHaveBeenCalled();
  });

  it.each(['active', 'inactive'])('passes %s through unchanged', async (status) => {
    const { importRows, importProducts } = adapterWith();
    await importRows([{ sku: 'A', status }]);
    expect(importProducts).toHaveBeenCalledWith([{ sku: 'A', status }]);
  });
});

/**
 * Feature 163 (T121, T123, FR-092) — the products file's `status@<channel code>` and
 * `status@<channel code>/<language>` columns: exported as the override at each scope
 * (empty where it inherits), read back into `scopedStatus` cells (empty = inherit),
 * a value that is not a status refusing the file. The `[PG]` round trip is
 * `backend/test/integration/catalog/bulk-import-scoped-status.test.ts`.
 */
function product(id: string, sku: string): CatalogProductRecord {
  return {
    id,
    sku,
    slug: sku.toLowerCase(),
    type: 'simple',
    status: 'active',
    visibility: 'public',
    name: { 'en-US': `Name ${sku}` },
    description: {},
  } as unknown as CatalogProductRecord;
}

function ports(imported: ProductImportRow[][]): ImportExportPorts {
  const scoped: ScopedStatusExport = {
    columns: [
      { channelCode: 'b2b', languageCode: null },
      { channelCode: 'b2b', languageCode: 'pl-PL' },
    ],
    values: { p1: { 'status@b2b': 'inactive' } },
  };
  return {
    catalogProducts: { listAll: async () => [product('p1', 'A'), product('p2', 'B')] },
    catalogBulkImport: {
      exportScopedStatuses: async () => scoped,
      importProducts: async (rows: readonly ProductImportRow[]) => {
        imported.push([...rows]);
        return { imported: rows.length, errors: [] };
      },
    },
  } as unknown as ImportExportPorts;
}

describe('products adapter — scoped status columns (163)', () => {
  it('exports one column per scope, the override or empty', async () => {
    const table = await productsAdapter(ports([])).exportTable!();
    expect(table.header.slice(-2)).toEqual(['status@b2b', 'status@b2b/pl-PL']);
    expect(table.rows.map((row) => row.slice(-2))).toEqual([
      ['inactive', ''],
      ['', ''],
    ]);
  });

  it('reads the cells back, an empty one as "use inherited", and leaves a row without them alone', async () => {
    const imported: ProductImportRow[][] = [];
    const report = await productsAdapter(ports(imported)).importRows!([
      { sku: 'A', 'status@b2b': 'inactive', 'status@b2b/pl-PL': '' },
      { sku: 'B' },
    ]);
    expect(report).toEqual({ imported: 2, errors: [] });
    expect(imported[0]).toEqual([
      {
        sku: 'A',
        scopedStatus: [
          { channelCode: 'b2b', languageCode: null, status: 'inactive' },
          { channelCode: 'b2b', languageCode: 'pl-PL', status: null },
        ],
      },
      { sku: 'B' },
    ]);
  });

  it.each(['sideways', 'draft', 'archived'])('refuses the file for %s, which is not a status', async (value) => {
    const imported: ProductImportRow[][] = [];
    const report = await productsAdapter(ports(imported)).importRows!([{ sku: 'A', 'status@b2b': value }]);
    expect(report).toEqual({ imported: 0, errors: [{ index: 0, reason: `invalid status@b2b: ${value}` }] });
    expect(imported).toEqual([]);
  });
});

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-041 import, research
 * R-15, R-20 (3)) — a Page Builder content attribute is authored on the product
 * content screen only. A products file carrying a value under a content
 * attribute's column gets a per-row error naming the attribute; the row's
 * other cells are still validated, so the operator sees every problem at once,
 * and — the import being all-or-nothing — nothing is imported.
 */
describe('products adapter — content attribute columns (172)', () => {
  function contentPorts(imported: ProductImportRow[][], contentAttributeKeys = vi.fn(async () => ['buying_guide'])) {
    const base = ports(imported) as unknown as { catalogBulkImport: Record<string, unknown> };
    base.catalogBulkImport['contentAttributeKeys'] = contentAttributeKeys;
    return { ports: base as unknown as ImportExportPorts, contentAttributeKeys };
  }

  it('refuses a non-empty content cell per row, naming the attribute, and imports nothing', async () => {
    const imported: ProductImportRow[][] = [];
    const { ports: p } = contentPorts(imported);
    const report = await productsAdapter(p).importRows!([
      { sku: 'A', buying_guide: '<p>Guide</p>' },
      { sku: 'B', buying_guide: '' },
    ]);
    expect(report).toEqual({
      imported: 0,
      errors: [{ index: 0, reason: 'content attribute "buying_guide" cannot be imported' }],
    });
    expect(imported).toEqual([]);
  });

  it('still validates the row’s other cells', async () => {
    const imported: ProductImportRow[][] = [];
    const { ports: p } = contentPorts(imported);
    const report = await productsAdapter(p).importRows!([{ sku: 'A', buying_guide: 'x', status: 'sideways' }]);
    expect(report.imported).toBe(0);
    expect(report.errors).toEqual([
      { index: 0, reason: 'content attribute "buying_guide" cannot be imported' },
      { index: 0, reason: 'invalid status: sideways' },
    ]);
  });

  it('imports a file whose content column is empty, and asks for the keys once', async () => {
    const imported: ProductImportRow[][] = [];
    const { ports: p, contentAttributeKeys } = contentPorts(imported);
    const report = await productsAdapter(p).importRows!([
      { sku: 'A', buying_guide: '' },
      { sku: 'B', buying_guide: '  ' },
    ]);
    expect(report).toEqual({ imported: 2, errors: [] });
    expect(contentAttributeKeys).toHaveBeenCalledTimes(1);
  });
});
