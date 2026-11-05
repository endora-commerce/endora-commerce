import { describe, expect, it } from 'vitest';
import {
  decodeCsvScopedCell,
  type CatalogProductRecord,
  type ImportProfile,
  type ProductImportRow,
  type ScopedValuesExport,
} from '@endora-commerce/contracts';
import { SCOPED_WRITE_CASES } from '../../../../../../contracts/src/scoped-write-encoding.cases.js';
import type { ImportExportPorts } from '../adapter.js';
import { productsAdapter } from './products.adapter.js';
import {
  ProductsFileError,
  parseProductsHeader,
  PRODUCTS_CSV_COLUMNS_MAX,
  PRODUCTS_REPORT_ERRORS_MAX,
} from './products-csv-grammar.js';

/**
 * Feature 174 (`specs/174-product-editor-scope-switcher/` T087; `contracts/import-profiles-and-csv.md`
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
  /** The rows each writing call carried, cells without their echoed `column`. */
  calls: ProductImportRow[][];
  /** The same, for `dryRun` calls (validation only). */
  dryCalls: ProductImportRow[][];
  /** The `column` each written cell echoed, in call order. */
  columns: Array<string | undefined>;
}

function rig(options: { products?: CatalogProductRecord[]; members?: Record<string, string[]> } = {}): Rig {
  const calls: ProductImportRow[][] = [];
  const dryCalls: ProductImportRow[][] = [];
  const columns: Array<string | undefined> = [];
  const products = options.products ?? [product('p1', 'A'), product('p2', 'B')];
  const members = options.members ?? { [VIP]: ['p1', 'p2'], [RETAIL]: ['p1'] };
  const scoped: ScopedValuesExport = {
    columns: [
      { field: 'status', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
      { field: 'status', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: 'pl-PL' },
    ],
    values: { p1: { 'status@pl_b2b_vip': { kind: 'text', text: 'inactive' } } },
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
        { key: 'multi', valueType: 'multiselect', scopable: true, isRequired: false },
        { key: 'finish', valueType: 'select', scopable: true, isRequired: false },
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
      exportScopedValues: async () => scoped,
      importProducts: async (rows: readonly ProductImportRow[], options?: { dryRun?: boolean }) => {
        const stripped = rows.map((row) => {
          if (row.cells === undefined) return row;
          if (options?.dryRun !== true) for (const cell of row.cells) columns.push(cell.column);
          return { ...row, cells: row.cells.map(({ column: _column, ...cell }) => cell) };
        });
        (options?.dryRun === true ? dryCalls : calls).push(stripped);
        return { imported: rows.length, errors: [] };
      },
    },
  } as unknown as ImportExportPorts;
  return { ports, calls, dryCalls, columns };
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

/**
 * Coordinator ruling (2026-11-03, `import-profiles-and-csv.md` §2.1): the file carries
 * `minOrderQuantity`, `returnable` and multiselect attribute columns at G and C. This is the
 * parser side of the shared case rows for those fields (`write-encoding.md` §4) — what the
 * adapter hands `catalog`; the catalog-side acceptance is S1's (T084).
 */
describe('products file — minimum order quantity, returnable and multiselect columns (§2.1)', () => {
  const column = (field: string, level: string) =>
    level === 'G' ? field : level === 'C' ? `${field}@pl_b2b_vip` : `${field}@pl_b2b_vip/pl-PL`;
  const scopeOf = (level: string) => (level === 'G' ? { level: 'global' as const } : { level: 'channel' as const, channelId: VIP });
  /** The typed value a decoded text becomes in the field's column. */
  const typed = (field: string, text: string): unknown =>
    field === 'minOrderQuantity' ? Number(text) : field === 'returnable' ? text === 'true' : text.split('|');
  const cases = SCOPED_WRITE_CASES.filter(
    (c) => c.csv !== undefined && ['minOrderQuantity', 'returnable', 'attribute:multi'].includes(c.field),
  );

  it('has case rows to run', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
  });

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const r = rig();
    const header = column(c.field, c.level);
    const report = await run(r, [{ sku: 'A', [header]: c.csv! }]);
    expect(report.errors).toEqual([]);
    const cells = r.calls[0]?.[0]?.cells ?? [];
    if (typeof c.expect === 'string') {
      if (c.expect === 'no_change') {
        expect(cells).toEqual([]);
        return;
      }
      expect(report.fieldErrors).toEqual([{ index: 0, column: header, code: c.expect }]);
      expect(cells).toEqual([]);
      return;
    }
    if (c.expect.op !== 'set') {
      expect(report.fieldErrors ?? []).toEqual([]);
      expect(cells).toEqual([{ scope: scopeOf(c.level), field: c.field, op: c.expect }]);
      return;
    }
    const value = typed(c.field, c.expect.value as string);
    if (typeof value === 'number' && !Number.isFinite(value)) {
      // The decoded text is no number (`'5` keeps its quote in a value column): refused per cell.
      expect(report.fieldErrors).toEqual([{ index: 0, column: header, code: 'invalid' }]);
      return;
    }
    expect(cells).toEqual([{ scope: scopeOf(c.level), field: c.field, op: { op: 'set', value } }]);
  });

  it('reads a minimum order quantity, a returnable flag and a multiselect at G and C', async () => {
    const r = rig();
    await run(r, [
      {
        sku: 'A',
        minOrderQuantity: '6',
        'minOrderQuantity@pl_b2b_vip': 'NULL',
        returnable: 'false',
        'returnable@pl_b2b_vip': 'INHERIT',
        'attribute:multi': 'red|blue',
        'attribute:multi@pl_b2b_vip': 'NULL',
      },
    ]);
    const VIP_C = { level: 'channel' as const, channelId: VIP };
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'global' }, field: 'minOrderQuantity', op: { op: 'set', value: 6 } },
      { scope: VIP_C, field: 'minOrderQuantity', op: { op: 'empty' } },
      { scope: { level: 'global' }, field: 'returnable', op: { op: 'set', value: false } },
      { scope: VIP_C, field: 'returnable', op: { op: 'inherit' } },
      { scope: { level: 'global' }, field: 'attribute:multi', op: { op: 'set', value: ['red', 'blue'] } },
      { scope: VIP_C, field: 'attribute:multi', op: { op: 'empty' } },
    ]);
  });

  it('refuses a C x L column of minimum order quantity or returnable (their levels are G and C)', async () => {
    const r = rig();
    await expect(run(r, [{ sku: 'A', 'minOrderQuantity@pl_b2b_vip/pl-PL': '2' }])).rejects.toBeInstanceOf(ProductsFileError);
    await expect(run(r, [{ sku: 'A', 'returnable@pl_b2b_vip/pl-PL': 'true' }])).rejects.toBeInstanceOf(ProductsFileError);
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
    // catalog validates the row too (its own refusals join the report) and writes nothing.
    expect(r.dryCalls).toHaveLength(1);
    expect(report.imported).toBe(1);
    expect(report.fieldErrors).toEqual([{ index: 0, column: 'name@pl_b2b_vip', code: 'required_empty' }]);
    expect(report.cellCounts).toEqual([
      { column: 'name@pl_b2b_vip', null: 1, inherit: 0 },
      { column: 'description@pl_b2b_vip', null: 0, inherit: 1 },
    ]);
  });

  it('names the file column on every cell it hands catalog, so catalog refusals point at it', async () => {
    const r = rig();
    await run(r, [{ sku: 'A', 'description@pl_b2b_vip': 'Kept', 'name@pl_retail/pl-PL': 'Nazwa' }]);
    expect(r.columns).toEqual(['description@pl_b2b_vip', 'name@pl_retail/pl-PL']);
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
        product('p1', 'A', { name: '=HYPERLINK("x")', description: null as never, minOrderQuantity: null, returnable: true }),
        product('p2', 'B', { name: 'NULL', description: "'quoted", minOrderQuantity: 6, returnable: false }),
      ],
    });
    const table = await productsAdapter(r.ports).exportTable!();
    expect(table.header).toEqual([
      'id', 'sku', 'slug', 'type', 'status', 'visibility', 'name', 'description', 'minOrderQuantity', 'returnable',
      'status@pl_b2b_vip', 'status@pl_b2b_vip/pl-PL',
    ]);
    // No minimum is the deliberately empty value; numbers and booleans take no formula guard.
    expect(table.rows[0]!.slice(6)).toEqual(["'=HYPERLINK(\"x\")", 'NULL', 'NULL', 'true', 'inactive', 'INHERIT']);
    expect(table.rows[1]!.slice(6)).toEqual(['\\NULL', "''quoted", '6', 'false', 'INHERIT', 'INHERIT']);
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
 * T087 export half: `CatalogBulkImportPort.exportScopedValues()`. A column appears where any
 * product holds an own value; an absent entry is `INHERIT`; an empty own value is `NULL`; text
 * columns are guarded, value columns are not; a multiselect joins with `|`.
 */
describe('products file — export of every scoped value (§3)', () => {
  it('writes one column per (field, scope) holding an own value, with tokens and the guard', async () => {
    const r = rig({ products: [product('p1', 'A'), product('p2', 'B')] });
    (r.ports.catalogBulkImport as unknown as Record<string, unknown>).exportScopedValues = async () => ({
      columns: [
        { field: 'name', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: 'pl-PL' },
        { field: 'description', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
        { field: 'status', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
        { field: 'attribute:material', channelId: RETAIL, channelCode: 'pl_retail', languageCode: null },
        { field: 'minOrderQuantity', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
        { field: 'attribute:multi', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
      ],
      values: {
        p1: {
          'name@pl_b2b_vip/pl-PL': { kind: 'text', text: '=SUM(A1)' },
          'description@pl_b2b_vip': { kind: 'empty' },
          'status@pl_b2b_vip': { kind: 'text', text: 'inactive' },
          'minOrderQuantity@pl_b2b_vip': { kind: 'value', value: 12 },
          'attribute:multi@pl_b2b_vip': { kind: 'value', value: ['red', 'blue'] },
        },
        p2: {
          'attribute:material@pl_retail': { kind: 'text', text: 'INHERIT' },
          'minOrderQuantity@pl_b2b_vip': { kind: 'empty' },
        },
      },
    });
    const table = await productsAdapter(r.ports).exportTable!();
    expect(table.header.slice(10)).toEqual([
      'name@pl_b2b_vip/pl-PL',
      'description@pl_b2b_vip',
      'status@pl_b2b_vip',
      'attribute:material@pl_retail',
      'minOrderQuantity@pl_b2b_vip',
      'attribute:multi@pl_b2b_vip',
    ]);
    expect(table.rows[0]!.slice(10)).toEqual(["'=SUM(A1)", 'NULL', 'inactive', 'INHERIT', '12', 'red|blue']);
    expect(table.rows[1]!.slice(10)).toEqual(['INHERIT', 'INHERIT', 'INHERIT', '\\INHERIT', 'NULL', 'INHERIT']);
  });
});

/**
 * C2/C3 security review (warn 1) — option values are text a PIM sync can create, so a select or
 * multiselect cell takes the formula guard like any text cell: guarded on export, the guard
 * stripped on import, and the two symmetric. A spreadsheet reads a formula only at the start of a
 * cell, so one guard per cell covers a multiselect whose first element starts one; numbers and
 * booleans stay unguarded.
 */
describe('products file — the formula guard on option values (FR-118)', () => {
  it('guards a select and a multiselect cell on export', async () => {
    const r = rig({ products: [product('p1', 'A')] });
    (r.ports.catalogBulkImport as unknown as Record<string, unknown>).exportScopedValues = async () => ({
      columns: [
        { field: 'attribute:finish', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
        { field: 'attribute:multi', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
        { field: 'attribute:weight', channelId: VIP, channelCode: 'pl_b2b_vip', languageCode: null },
      ],
      values: {
        p1: {
          'attribute:finish@pl_b2b_vip': { kind: 'value', value: '=HYPERLINK("x")' },
          'attribute:multi@pl_b2b_vip': { kind: 'value', value: ['@cmd', 'blue'] },
          'attribute:weight@pl_b2b_vip': { kind: 'value', value: -5 },
        },
      },
    });
    const table = await productsAdapter(r.ports).exportTable!();
    expect(table.rows[0]!.slice(10)).toEqual(["'=HYPERLINK(\"x\")", "'@cmd|blue", '-5']);
  });

  it('strips the guard from a select and a multiselect cell on import', async () => {
    const r = rig();
    await run(r, [{ sku: 'A', 'attribute:finish@pl_b2b_vip': "'=matte", 'attribute:multi@pl_b2b_vip': "'-red|blue" }]);
    expect(r.calls[0]![0]!.cells).toEqual([
      { scope: { level: 'channel', channelId: VIP }, field: 'attribute:finish', op: { op: 'set', value: '=matte' } },
      { scope: { level: 'channel', channelId: VIP }, field: 'attribute:multi', op: { op: 'set', value: ['-red', 'blue'] } },
    ]);
  });
});

/**
 * C2/C3 security review (warn 2) — within the file caps a report could still list millions of
 * refusals. The report lists at most `PRODUCTS_REPORT_ERRORS_MAX` row errors and as many field
 * errors, and says how many there were in `truncated`.
 */
describe('products file — the bounded report', () => {
  it('lists at most the cap of row and field errors and counts the rest', async () => {
    const r = rig();
    const total = PRODUCTS_REPORT_ERRORS_MAX + 7;
    const records = [
      ...Array.from({ length: total }, () => ({ sku: '', 'name@pl_b2b_vip': 'x' })),
      ...Array.from({ length: total }, (_, i) => ({ sku: `S${i}`, 'name@pl_b2b_vip': "'" })),
    ];
    const report = await run(r, records);
    expect(report.errors).toHaveLength(PRODUCTS_REPORT_ERRORS_MAX);
    expect(report.fieldErrors).toHaveLength(PRODUCTS_REPORT_ERRORS_MAX);
    expect(report.truncated).toEqual({ errors: total, fieldErrors: total });
  });

  it('has no truncation entry when every refusal is listed', async () => {
    const r = rig();
    const report = await run(r, [{ sku: '', 'name@pl_b2b_vip': 'x' }]);
    expect(report.errors).toHaveLength(1);
    expect(report.truncated).toBeUndefined();
  });
});

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-041 import, research
 * R-15, R-20 (3)) — a Page Builder content attribute is authored on the product
 * content screen only. In feature 174's grammar its column is `attribute:<key>`,
 * Global only (the attribute is not scopable): a non-empty cell there is refused
 * as a field error naming the column, and the row's other cells still apply —
 * each product row being its own write (`import-profiles-and-csv.md` §2).
 */
describe('products file — content attribute columns (172 FR-041)', () => {
  function contentRig(): Rig {
    const r = rig();
    const attributes = r.ports.catalogAttributes as unknown as { listAll: () => Promise<unknown[]> };
    const base = attributes.listAll;
    attributes.listAll = async () => [
      ...(await base()),
      { key: 'buying_guide', valueType: 'page_builder', scopable: false, isRequired: false },
    ];
    return r;
  }

  it('refuses a non-empty content cell, naming its column, and applies the rest of the row', async () => {
    const r = contentRig();
    const report = await run(r, [
      { sku: 'A', 'attribute:buying_guide': '<p>Guide</p>', 'name@pl_b2b_vip': 'Kept' },
      { sku: 'B', 'attribute:buying_guide': '', 'name@pl_b2b_vip': 'Also kept' },
    ]);
    expect(report.errors).toEqual([]);
    expect(report.fieldErrors).toEqual([{ index: 0, column: 'attribute:buying_guide', code: 'content_attribute' }]);
    // One call per product (`import-profiles-and-csv.md` §2).
    expect(r.calls).toEqual([
      [{ sku: 'A', cells: [{ scope: { level: 'channel', channelId: VIP }, field: 'name', op: { op: 'set', value: 'Kept' } }] }],
      [
        {
          sku: 'B',
          cells: [{ scope: { level: 'channel', channelId: VIP }, field: 'name', op: { op: 'set', value: 'Also kept' } }],
        },
      ],
    ]);
  });

  it('refuses a token or a mapped locale cell under a content column too, and writes nothing for it', async () => {
    const r = contentRig();
    const report = await run(r, [
      { sku: 'A', 'attribute:buying_guide': 'NULL' },
      { sku: 'B', 'attribute:buying_guide[pl_PL]': 'Poradnik' },
    ]);
    expect(report.fieldErrors).toEqual([
      { index: 0, column: 'attribute:buying_guide', code: 'content_attribute' },
      { index: 1, column: 'attribute:buying_guide[pl_PL]', code: 'content_attribute' },
    ]);
    expect(r.calls).toEqual([]);
  });

  it('refuses a content column at a channel scope as a file error: the attribute is Global only', async () => {
    const r = contentRig();
    await expect(run(r, [{ sku: 'A', 'attribute:buying_guide@pl_b2b_vip': 'x' }])).rejects.toBeInstanceOf(
      ProductsFileError,
    );
  });
});
