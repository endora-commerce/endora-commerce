import { describe, expect, it } from 'vitest';
import {
  decodeCsvScopedCell,
  type CatalogProductRecord,
  type ImportProfile,
  type ProductImportRow,
  type ScopedStatusExport,
} from '@endora-commerce/contracts';
import type { ImportExportPorts } from '../adapter.js';
import { productsAdapter } from './products.adapter.js';
import { ProductsFileError, parseProductsHeader, PRODUCTS_CSV_COLUMNS_MAX } from './products-csv-grammar.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T087; `contracts/import-profiles-and-csv.md`
 * §2–§3, `write-encoding.md` §3, §3a; FR-040…FR-043, FR-110…FR-118) — the products file over fake
 * ports: the header grammar, the write encoding of every cell, the profile mapping, the report,
 * one port call per product and the dry run. The `[PG]` halves are
 * `backend/test/integration/import_export/products-csv-*.test.ts`.
 */
const VIP = '00000000-0000-4000-8000-0000000000a1';
const RETAIL = '00000000-0000-4000-8000-0000000000a2';

function product(id: string, sku: string, extra: Partial<CatalogProductRecord> = {}): CatalogProductRecord {
  return {
    id,
    sku,
    slug: sku.toLowerCase(),
    type: 'simple',
    status: 'active',
    visibility: 'public',
    name: `Name ${sku}`,
    description: `Description ${sku}`,
    ...extra,
  } as unknown as CatalogProductRecord;
}

const PROFILE: ImportProfile = {
  id: '00000000-0000-4000-8000-0000000000f1',
  name: 'Quickstart',
  entity: 'products',
  sourceLanguageForGlobal: 'en_US',
  localeMapping: [{ sourceLocale: 'pl_PL', sourceChannel: null, targets: [{ channelId: VIP, languageCode: 'pl-PL' }] }],
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:00:00.000Z',
};

interface Rig {
  ports: ImportExportPorts;
  calls: ProductImportRow[][];
}

function rig(options: { products?: CatalogProductRecord[]; members?: Record<string, string[]> } = {}): Rig {
  const calls: ProductImportRow[][] = [];
  const products = options.products ?? [product('p1', 'A'), product('p2', 'B')];
  const members = options.members ?? { [VIP]: ['p1', 'p2'], [RETAIL]: ['p1'] };
  const scoped: ScopedStatusExport = {
    columns: [
      { channelCode: 'pl_b2b_vip', languageCode: null },
      { channelCode: 'pl_b2b_vip', languageCode: 'pl-PL' },
    ],
    values: { p1: { 'status@pl_b2b_vip': 'inactive' } },
  };
  const ports = {
    catalogProducts: {
      listAll: async () => products,
      findBySkus: async (skus: readonly string[]) => products.filter((p) => skus.includes(p.sku)),
    },
    catalogAttributes: {
      listAll: async () => [
        { key: 'material', valueType: 'string', scopable: true, isRequired: false },
        { key: 'weight', valueType: 'number', scopable: true, isRequired: false },
        { key: 'code', valueType: 'string', scopable: false, isRequired: false },
      ],
    },
    catalogAvailability: {
      describeChannelAvailability: async (ids: readonly string[], channelId: string) =>
        new Map(ids.filter((id) => members[channelId]?.includes(id)).map((id) => [id, {}])),
    },
    salesChannels: {
      listAll: async () => [
        { id: VIP, code: 'pl_b2b_vip', languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' },
        { id: RETAIL, code: 'pl_retail', languages: ['pl-PL', 'en-US'], defaultLanguage: 'pl-PL' },
      ],
    },
    catalogBulkImport: {
      exportScopedStatuses: async () => scoped,
      importProducts: async (rows: readonly ProductImportRow[]) => {
        calls.push([...rows]);
        return { imported: rows.length, errors: [] };
      },
    },
  } as unknown as ImportExportPorts;
  return { ports, calls };
}

async function run(
  r: Rig,
  records: Array<Record<string, string>>,
  options: { dryRun?: boolean; profile?: ImportProfile; header?: string[] } = {},
) {
  const header = options.header ?? [...new Set(records.flatMap((record) => Object.keys(record)))];
  return productsAdapter(r.ports).importRows!(records, {
    profile: options.profile ?? PROFILE,
    dryRun: options.dryRun ?? false,
    header,
  });
}

const cl = (channelId: string, languageCode: string) => ({ level: 'channel_language' as const, channelId, languageCode });

describe('products file — header grammar (§2.1, R14)', () => {
  const ctx = {
    channels: [{ id: VIP, code: 'pl_b2b_vip', languages: ['pl-PL', 'en-US'] }],
    attributes: new Map([
      ['material', { key: 'material', valueType: 'string' as const, scopable: true, isRequired: false }],
      ['weight', { key: 'weight', valueType: 'number' as const, scopable: true, isRequired: false }],
    ]),
  };

  it('accepts every rule of the grammar', () => {
    const parsed = parseProductsHeader(
      ['sku', 'id', 'slug', 'type', 'visibility', 'name', 'description@pl_b2b_vip', 'name@pl_b2b_vip/pl-pl', 'name[pl_PL]', 'name[de_DE|print]', 'attribute:weight@pl_b2b_vip'],
      ctx,
    );
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ['an unknown column', ['sku', 'name_en']],
    ['an unknown channel', ['sku', 'name@nowhere']],
    ['a language the channel does not offer', ['sku', 'name@pl_b2b_vip/de-DE']],
    ['a C x L column of a field without C x L', ['sku', 'attribute:weight@pl_b2b_vip/pl-PL']],
    ['an unknown attribute', ['sku', 'attribute:colour']],
    ['two headers equal after normalisation', ['sku', 'name[pl_PL]', 'name[pl-pl]']],
    ['a duplicated column', ['sku', 'name', 'name']],
    ['an over-long channel code', ['sku', `name@${'x'.repeat(101)}`]],
    ['injection characters in a code', ['sku', 'name@pl_b2b_vip;drop']],
    ['a quote in a locale', ['sku', "name[pl_PL'x]"]],
    ['no sku', ['name']],
  ])('refuses the file for %s', (_label, header) => {
    expect(parseProductsHeader(header, ctx).ok).toBe(false);
  });

  it('refuses more columns than the cap', () => {
    const header = ['sku', ...Array.from({ length: PRODUCTS_CSV_COLUMNS_MAX }, (_, i) => `attribute:material@c${i}`)];
    expect(parseProductsHeader(header, ctx).ok).toBe(false);
  });
});

describe('products file — import cells (write-encoding §3, §3a)', () => {
  it('reads empty as no change, NULL as empty, INHERIT as inherit, escaped and guarded text verbatim', async () => {
    const r = rig();
    const report = await run(r, [
      {
        sku: 'A',
        'name@pl_b2b_vip': '',
        'description@pl_b2b_vip': 'NULL',
        'description@pl_b2b_vip/pl-PL': 'INHERIT',
        'name@pl_retail': '\\NULL',
        'name@pl_retail/pl-PL': "'=1+1",
      },
    ]);
    expect(report.errors).toEqual([]);
    expect(r.calls).toEqual([
      [
        {
          sku: 'A',
          cells: [
            { scope: { level: 'channel', channelId: VIP }, field: 'description', op: { op: 'empty' } },
            { scope: cl(VIP, 'pl-PL'), field: 'description', op: { op: 'inherit' } },
            { scope: { level: 'channel', channelId: RETAIL }, field: 'name', op: { op: 'set', value: 'NULL' } },
            { scope: cl(RETAIL, 'pl-PL'), field: 'name', op: { op: 'set', value: '=1+1' } },
          ],
        },
      ],
    ]);
    expect(report.cellCounts).toEqual([
      { column: 'description@pl_b2b_vip', null: 1, inherit: 0 },
      { column: 'description@pl_b2b_vip/pl-PL', null: 0, inherit: 1 },
    ]);
  });

  it('strips the formula guard from text columns only, never from a numeric column (FR-118)', async () => {
    const r = rig();
    await run(r, [{ sku: 'A', 'attribute:material@pl_b2b_vip': "'-5", 'attribute:weight@pl_b2b_vip': '-5' }]);
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'channel', channelId: VIP }, field: 'attribute:material', op: { op: 'set', value: '-5' } },
      { scope: { level: 'channel', channelId: VIP }, field: 'attribute:weight', op: { op: 'set', value: -5 } },
    ]);
  });

  it("refuses a lone ' (empty text has no CSV form) as a field error, applying the rest of the row", async () => {
    const r = rig();
    const report = await run(r, [{ sku: 'A', 'name@pl_b2b_vip': "'", 'description@pl_b2b_vip': 'Kept' }]);
    expect(report.fieldErrors).toEqual([{ index: 0, column: 'name@pl_b2b_vip', code: 'invalid' }]);
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'channel', channelId: VIP }, field: 'description', op: { op: 'set', value: 'Kept' } },
    ]);
  });

  it('never reads an op-shaped cell as an op: it is the text it says', async () => {
    const r = rig();
    const spoof = '{"op":"empty"}';
    const report = await run(r, [{ sku: 'A', 'attribute:material[pl_PL]': spoof, 'attribute:material@pl_retail': spoof }]);
    expect(report.errors).toEqual([]);
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'channel', channelId: RETAIL }, field: 'attribute:material', op: { op: 'set', value: spoof } },
      { scope: cl(VIP, 'pl-PL'), field: 'attribute:material', op: { op: 'set', value: spoof } },
    ]);
  });

  it.each([
    ['NULL on the required name', 'name', 'NULL', 'required_empty'],
    ['NULL on the status (a single select)', 'status@pl_b2b_vip', 'NULL', 'not_emptyable'],
    ['INHERIT at Global', 'description', 'INHERIT', 'inherit_at_global'],
    ['a status that is not one', 'status@pl_b2b_vip', 'draft', 'invalid'],
    ['a number that is not one', 'attribute:weight@pl_b2b_vip', 'heavy', 'invalid'],
  ])('reports %s as a field error and applies the rest of the row', async (_label, column, cell, code) => {
    const r = rig();
    const report = await run(r, [{ sku: 'A', [column]: cell, 'description@pl_retail': 'Kept' }]);
    expect(report.fieldErrors).toEqual([{ index: 0, column, code }]);
    expect(report.errors).toEqual([]);
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'channel', channelId: RETAIL }, field: 'description', op: { op: 'set', value: 'Kept' } },
    ]);
  });

  it('keeps the Global status and visibility on the row, as today', async () => {
    const r = rig();
    await run(r, [{ sku: 'A', status: 'inactive', visibility: 'public' }]);
    expect(r.calls).toEqual([[{ sku: 'A', status: 'inactive', visibility: 'public' }]]);
  });
});

describe('products file — the profile mapping (FR-040…FR-042, FR-047)', () => {
  it('writes the Global source locale to Global and a mapped locale to its C x L targets', async () => {
    const r = rig();
    await run(r, [{ sku: 'A', 'name[en_US]': 'Drill X', 'name[pl_PL]': 'Wiertarka X' }]);
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'global' }, field: 'name', op: { op: 'set', value: 'Drill X' } },
      { scope: cl(VIP, 'pl-PL'), field: 'name', op: { op: 'set', value: 'Wiertarka X' } },
    ]);
  });

  it('warns once per unmapped locale with the count of products, writing it nowhere (SC-005)', async () => {
    const r = rig();
    const report = await run(r, [
      { sku: 'A', 'name[de_DE]': 'Bohrmaschine' },
      { sku: 'B', 'name[de_DE]': 'Schraube' },
    ]);
    expect(report.warnings).toEqual([{ kind: 'unmapped_locale', locale: 'de_DE', sourceChannel: null, products: 2 }]);
    expect(r.calls).toEqual([]);
  });

  it('reports a target the product does not belong to for that row, and writes the rest (FR-042)', async () => {
    const r = rig({ members: { [VIP]: ['p1'] } });
    const report = await run(r, [
      { sku: 'A', 'name[pl_PL]': 'Wiertarka' },
      { sku: 'B', 'name[pl_PL]': 'Sruba', 'description@pl_retail': 'Kept' },
    ]);
    expect(report.fieldErrors).toEqual([{ index: 1, column: 'name[pl_PL]', code: 'not_a_member' }]);
    expect(r.calls).toEqual([
      [{ sku: 'A', cells: [{ scope: cl(VIP, 'pl-PL'), field: 'name', op: { op: 'set', value: 'Wiertarka' } }] }],
      [{ sku: 'B', cells: [{ scope: { level: 'channel', channelId: RETAIL }, field: 'description', op: { op: 'set', value: 'Kept' } }] }],
    ]);
  });

  it('refuses a row whose scope column and mapped locale column land on one cell (IMPORT_CELL_CONFLICT)', async () => {
    const r = rig();
    const report = await run(r, [
      { sku: 'A', 'name@pl_b2b_vip/pl-PL': 'One', 'name[pl_PL]': 'Two' },
      { sku: 'B', 'name[pl_PL]': 'Fine' },
    ]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatchObject({ index: 0 });
    expect(report.errors[0]!.reason).toContain('IMPORT_CELL_CONFLICT');
    expect(r.calls.map((call) => call[0]!.sku)).toEqual(['B']);
  });
});

describe('products file — the run (§2)', () => {
  it('calls the port once per product, so each product is its own transaction', async () => {
    const r = rig();
    const report = await run(r, [
      { sku: 'A', 'name@pl_b2b_vip': 'One' },
      { sku: 'B', 'name@pl_b2b_vip': 'Two' },
      { sku: 'B2' },
    ]);
    expect(r.calls).toHaveLength(2);
    expect(report.imported).toBe(2);
  });

  it('writes nothing on a dry run and reports what it would do', async () => {
    const r = rig();
    const report = await run(r, [{ sku: 'A', 'name@pl_b2b_vip': 'NULL', 'description@pl_b2b_vip': 'INHERIT' }], {
      dryRun: true,
    });
    expect(r.calls).toEqual([]);
    expect(report.imported).toBe(1);
    expect(report.fieldErrors).toEqual([{ index: 0, column: 'name@pl_b2b_vip', code: 'required_empty' }]);
    expect(report.cellCounts).toEqual([
      { column: 'name@pl_b2b_vip', null: 1, inherit: 0 },
      { column: 'description@pl_b2b_vip', null: 0, inherit: 1 },
    ]);
  });

  it('refuses the whole file for a header error before any port write', async () => {
    const r = rig();
    await expect(run(r, [{ sku: 'A', name_en: 'x' }])).rejects.toBeInstanceOf(ProductsFileError);
    expect(r.calls).toEqual([]);
  });

  it('refuses a missing sku per row', async () => {
    const r = rig();
    const report = await run(r, [{ sku: '', name: 'x' }]);
    expect(report.errors).toEqual([{ index: 0, reason: 'sku is required' }]);
  });
});

describe('products file — export (§3, write-encoding §3a)', () => {
  it('writes tokens for inherited and empty scopes and guards every text column', async () => {
    const r = rig({
      products: [
        product('p1', 'A', { name: '=HYPERLINK("x")', description: null as never }),
        product('p2', 'B', { name: 'NULL', description: "'quoted" }),
      ],
    });
    const table = await productsAdapter(r.ports).exportTable!();
    expect(table.header).toEqual([
      'id', 'sku', 'slug', 'type', 'status', 'visibility', 'name', 'description', 'status@pl_b2b_vip', 'status@pl_b2b_vip/pl-PL',
    ]);
    expect(table.rows[0]!.slice(6)).toEqual(["'=HYPERLINK(\"x\")", 'NULL', 'inactive', 'INHERIT']);
    expect(table.rows[1]!.slice(6)).toEqual(['\\NULL', "''quoted", 'INHERIT', 'INHERIT']);
  });

  it('round-trips every exported text cell through the import decoder (FR-114, FR-118)', async () => {
    const texts = ['=1+1', '+x', '-5', '@a', '\tTab', '\rCR', "'q", 'NULL', 'INHERIT', '\\NULL', 'plain'];
    const r = rig({ products: texts.map((name, i) => product(`p${i}`, `S${i}`, { name })) });
    const table = await productsAdapter(r.ports).exportTable!();
    for (const [i, row] of table.rows.entries()) {
      expect(decodeCsvScopedCell(row[6]!, { column: 'text' })).toEqual({ kind: 'text', text: texts[i] });
    }
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
