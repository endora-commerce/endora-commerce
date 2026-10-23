import { describe, expect, it } from 'vitest';
import { PRICE_BOOK_MAX_ROWS, priceBookBatchRowInputSchema } from '@endora-commerce/contracts';
import {
  CSV_COLUMNS,
  CSV_MAX_BYTES,
  csvHeader,
  decodeCsv,
  exportCsv,
  exportFileName,
  exportFiles,
  fileSizeRefusal,
  parseCsv,
  refusedRowsCsv,
  serverLineErrors,
  type CsvExportRow,
  type CsvParsed,
} from './price-book-csv.js';

/**
 * The price-book CSV codec (feature 161, T089; FR-018, FR-038, FR-039;
 * `contracts/csv-format.md`).
 *
 * Export: the fixed header in English or Polish, a BOM, `;`, CRLF, a decimal
 * comma for a Polish administrator, a view over 5 000 rows split into numbered
 * files of at most 5 000 rows. Import: `;` or `,` sniffed from the header,
 * RFC 4180 quotes, a decimal comma or point with grouping spaces, UTF-8 with or
 * without a BOM and Windows-1250 when UTF-8 fails, headers and kinds in either
 * language, every refused header named, the size and row limits refused before
 * any request, and every line error naming its file line and its column.
 *
 * **Time budget**: a 5 000-row file parses in under 1 000 ms on the CI runner
 * (measured 2026-10-23 on the development machine: ~40 ms; the budget is
 * twenty-five times that, so it catches an accidental quadratic, not jitter).
 */

const P1: CsvExportRow = {
  selectionKind: 'product',
  naturalKey: { productSku: 'P1' },
  minQuantity: 1,
  maxQuantity: 9,
  price: { type: 'percent', percent: '-20.00' },
};
const P1_10: CsvExportRow = {
  selectionKind: 'product',
  naturalKey: { productSku: 'P1' },
  minQuantity: 10,
  maxQuantity: null,
  price: { type: 'fixed', amount: '1234.5000' },
};
const V1: CsvExportRow = {
  selectionKind: 'variant',
  naturalKey: { productSku: 'P1', variantSku: 'P1-RED' },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'amount', amount: '-3.0000' },
};
const CAT: CsvExportRow = {
  selectionKind: 'category',
  naturalKey: { categoryPath: 'tools/screws' },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'percent', percent: '5.00' },
};
const CAT_ATTR: CsvExportRow = {
  selectionKind: 'category_attribute',
  naturalKey: { categoryPath: 'tools/screws', attribute: { key: 'color', valueCode: 'red' } },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'fixed', amount: '120.0000' },
};
const ATTR: CsvExportRow = {
  selectionKind: 'attribute',
  naturalKey: { attribute: { key: 'finish', valueCode: 'zinc;plated "A"' } },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'amount', amount: '2.5000' },
};
const ALL: CsvExportRow = {
  selectionKind: 'all',
  naturalKey: {},
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'percent', percent: '0.00' },
};
const ROWS = [P1, P1_10, V1, CAT, CAT_ATTR, ATTR, ALL];

const EN_HEADER = 'kind;product_sku;variant_sku;category_path;attribute_key;attribute_value;min_quantity;max_quantity;price_kind;value';
const PL_HEADER = 'rodzaj;sku_produktu;sku_wariantu;sciezka_kategorii;kod_atrybutu;wartosc_atrybutu;od_ilosci;do_ilosci;typ_ceny;wartosc';

function parsed(text: string): CsvParsed {
  const result = parseCsv(text);
  if (!result.ok) throw new Error(`file refused: ${JSON.stringify(result.error)}`);
  return result;
}

/** A file of the English header and these data lines, `;`-separated. */
const file = (...lines: string[]): string => [EN_HEADER, ...lines].join('\r\n');

describe('export', () => {
  it('writes the fixed header in English and in Polish', () => {
    expect(csvHeader('en').join(';')).toBe(EN_HEADER);
    expect(csvHeader('pl').join(';')).toBe(PL_HEADER);
    expect(CSV_COLUMNS).toHaveLength(10);
  });

  it('writes a BOM, `;`, CRLF and one line per tier, with a decimal point in English', () => {
    const text = exportCsv(ROWS, 'en');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.slice(1).split('\r\n')).toEqual([
      EN_HEADER,
      'product;P1;;;;;1;9;percent;-20.00',
      'product;P1;;;;;10;;fixed;1234.50',
      'variant;P1;P1-RED;;;;1;;amount;-3.00',
      'category;;;tools/screws;;;1;;percent;+5.00',
      'category_attribute;;;tools/screws;color;red;1;;fixed;120.00',
      'attribute;;;;finish;"zinc;plated ""A""";1;;amount;+2.50',
      'all;;;;;;1;;percent;0.00',
      '',
    ]);
  });

  it('writes Polish headers, kinds and a decimal comma for a Polish administrator', () => {
    const lines = exportCsv([P1_10, V1], 'pl').slice(1).split('\r\n');
    expect(lines[0]).toBe(PL_HEADER);
    expect(lines[1]).toBe('produkt;P1;;;;;10;;stala;1234,50');
    expect(lines[2]).toBe('wariant;P1;P1-RED;;;;1;;kwota;-3,00');
  });

  it('names the file after the book, the day and the decimal language', () => {
    const day = new Date('2026-10-23T15:00:00Z');
    expect(exportFileName('Acme contract', day, 'en')).toBe('acme-contract-2026-10-23-en.csv');
    expect(exportFileName('Wkręty – Łódź', day, 'pl')).toBe('wkrety-lodz-2026-10-23-pl.csv');
  });

  it('splits a view over 5 000 rows into numbered files of at most 5 000 rows, each with its header', () => {
    const many = Array.from({ length: 12_001 }, (_, i): CsvExportRow => ({ ...P1_10, minQuantity: i + 1 }));
    const files = exportFiles(many, { bookName: 'Big', date: new Date('2026-10-23T12:00:00Z'), language: 'en' });
    expect(files.map((f) => f.name)).toEqual([
      'big-2026-10-23-en-1-of-3.csv',
      'big-2026-10-23-en-2-of-3.csv',
      'big-2026-10-23-en-3-of-3.csv',
    ]);
    const counts = files.map((f) => f.content.slice(1).split('\r\n').filter((l) => l !== '').length - 1);
    expect(counts).toEqual([5000, 5000, 2001]);
    for (const f of files) expect(f.content.slice(1).startsWith(EN_HEADER)).toBe(true);
    expect(exportFiles([P1], { bookName: 'Small', date: new Date('2026-10-23T12:00:00Z'), language: 'pl' }).map((f) => f.name)).toEqual([
      'small-2026-10-23-pl.csv',
    ]);
  });
});

describe('import — the round trip', () => {
  for (const language of ['en', 'pl'] as const) {
    it(`reads back an ${language} export as the rows it was written from`, () => {
      const result = parsed(exportCsv(ROWS, language));
      expect(result.errors).toEqual([]);
      expect(result.rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
      expect(result.rows.map((r) => r.input)).toEqual(
        ROWS.map((row) => ({ key: row.naturalKey, minQuantity: row.minQuantity, maxQuantity: row.maxQuantity, price: row.price })),
      );
      for (const row of result.rows) expect(priceBookBatchRowInputSchema.safeParse(row.input).success).toBe(true);
    });
  }
});

describe('import — separators, quotes, numbers', () => {
  it('sniffs `,` from the header line and honours quotes holding either separator', () => {
    const text = [
      EN_HEADER.replaceAll(';', ','),
      'product,P1,,,,,1,,fixed,"1 234,50"',
      'attribute,,,,finish,"a,b;c",1,,amount,+2.5',
    ].join('\n');
    const result = parsed(text);
    expect(result.separator).toBe(',');
    expect(result.errors).toEqual([]);
    expect(result.rows[0]!.input.price).toEqual({ type: 'fixed', amount: '1234.5000' });
    expect(result.rows[1]!.input.key).toEqual({ attribute: { key: 'finish', valueCode: 'a,b;c' } });
  });

  it('reads a decimal comma or point, a grouping space, a currency symbol, and the last of `,` and `.` as the decimal', () => {
    const result = parsed(
      file(
        'product;P1;;;;;1;;fixed;95,5',
        'product;P2;;;;;1;;fixed;95.5',
        'product;P3;;;;;1;;fixed;1 234,50 zł',
        'product;P4;;;;;1;;fixed;1.234,5',
        'product;P5;;;;;1;;fixed;1,234.5',
        'product;P6;;;;;1;;percent;−5,5',
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.input.price)).toEqual([
      { type: 'fixed', amount: '95.5000' },
      { type: 'fixed', amount: '95.5000' },
      { type: 'fixed', amount: '1234.5000' },
      { type: 'fixed', amount: '1234.5000' },
      { type: 'fixed', amount: '1234.5000' },
      { type: 'percent', percent: '-5.50' },
    ]);
  });

  it('accepts Polish kind and price-kind aliases under an English header, and the other way round', () => {
    const result = parsed(file('produkt;P1;;;;;1;;stala;10', 'wszystkie;;;;;;1;;procent;-2'));
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => [r.input.key, r.input.price])).toEqual([
      [{ productSku: 'P1' }, { type: 'fixed', amount: '10.0000' }],
      [{}, { type: 'percent', percent: '-2.00' }],
    ]);
    const pl = parsed([PL_HEADER, 'product;P1;;;;;1;;fixed;10'].join('\n'));
    expect(pl.headerLanguage).toBe('pl');
    expect(pl.errors).toEqual([]);
  });

  it('ignores empty lines and a trailing newline, and keeps file line numbers', () => {
    const result = parsed(file('', 'product;P1;;;;;1;;fixed;10', ';;;;;;;;;', '') + '\r\n\r\n');
    expect(result.rows.map((r) => r.line)).toEqual([3]);
  });
});

describe('import — encodings (FR-039)', () => {
  const utf8 = new TextEncoder().encode(`${PL_HEADER}\nkategoria;;;wkręty-łódź;;;1;;procent;-5\n`);

  it('reads UTF-8, with or without a BOM, as certain', () => {
    expect(decodeCsv(utf8)).toEqual({ text: `${PL_HEADER}\nkategoria;;;wkręty-łódź;;;1;;procent;-5\n`, encoding: 'utf-8', uncertain: false });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeCsv(bom).text.startsWith('rodzaj')).toBe(true);
  });

  it('falls back to Windows-1250 when the bytes are not UTF-8, and says it is not sure', () => {
    // The Polish letters of the path as Windows-1250 bytes: e-ogonek 0xEA, l-stroke 0xB3, o-acute 0xF3, z-acute 0x9F.
    const cp1250 = new Uint8Array([...new TextEncoder().encode('kategoria;;;wkr'), 0xea, ...new TextEncoder().encode('ty-'), 0xb3, 0xf3, 0x64, 0x9f]);
    const decoded = decodeCsv(cp1250);
    expect(decoded).toEqual({ text: 'kategoria;;;wkręty-łódź', encoding: 'windows-1250', uncertain: true });
    // The administrator may switch; the choice is honoured as given.
    expect(decodeCsv(cp1250, 'utf-8').encoding).toBe('utf-8');
    expect(decodeCsv(cp1250, 'windows-1250')).toEqual({ text: 'kategoria;;;wkręty-łódź', encoding: 'windows-1250', uncertain: false });
  });
});

describe('import — the file refused before parsing (FR-038, FR-039)', () => {
  it('refuses a file over 5 MB before reading it', () => {
    expect(CSV_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(fileSizeRefusal(CSV_MAX_BYTES)).toBeNull();
    expect(fileSizeRefusal(CSV_MAX_BYTES + 1)).toEqual({ code: 'tooLarge', maxBytes: CSV_MAX_BYTES });
  });

  it('refuses more than 5 000 data lines before any request', () => {
    const lines = Array.from({ length: PRICE_BOOK_MAX_ROWS + 1 }, (_, i) => `product;P${i};;;;;1;;fixed;10`);
    expect(parseCsv(file(...lines))).toEqual({ ok: false, error: { code: 'tooManyRows', max: PRICE_BOOK_MAX_ROWS, count: PRICE_BOOK_MAX_ROWS + 1 } });
  });

  it('refuses an empty file', () => {
    expect(parseCsv('')).toEqual({ ok: false, error: { code: 'empty' } });
    expect(parseCsv('﻿\r\n')).toEqual({ ok: false, error: { code: 'empty' } });
  });

  it('names unknown, duplicated and missing headers, and a wrong order', () => {
    expect(parseCsv(`${EN_HEADER};price;colour\nx`)).toEqual({ ok: false, error: { code: 'unknownColumns', columns: ['price', 'colour'] } });
    expect(parseCsv(EN_HEADER.replace('variant_sku', 'product_sku'))).toEqual({
      ok: false,
      error: { code: 'duplicateColumns', columns: ['product_sku'] },
    });
    expect(parseCsv(EN_HEADER.replace(';value', ''))).toEqual({ ok: false, error: { code: 'missingColumns', columns: ['value'] } });
    expect(parseCsv('value;kind;product_sku;variant_sku;category_path;attribute_key;attribute_value;min_quantity;max_quantity;price_kind')).toEqual({
      ok: false,
      error: { code: 'columnOrder', expected: EN_HEADER.split(';') },
    });
  });

  it('reads headers case- and space-insensitively, and accepts a refused-rows file’s reason column', () => {
    const result = parsed(`${EN_HEADER.toUpperCase().replaceAll(';', ' ; ')};reason\nproduct;P1;;;;;1;;fixed;10;No product has the SKU P1.`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(parsed(`${PL_HEADER};powod\nprodukt;P1;;;;;1;;stala;10;x`).rows).toHaveLength(1);
  });

  it('refuses a quote that is never closed, naming its line', () => {
    expect(parseCsv(file('product;"P1;;;;;1;;fixed;10'))).toEqual({ ok: false, error: { code: 'unclosedQuote', line: 2 } });
  });
});

describe('import — every line error names its line and its column', () => {
  const errorsOf = (...lines: string[]) => parsed(file(...lines)).errors;

  it('refuses a line with the wrong number of fields', () => {
    expect(errorsOf('product;P1;1;fixed;10')).toEqual([{ line: 2, column: null, code: 'columnCount', params: { expected: 10, found: 5 } }]);
  });

  it('refuses an unknown kind and an unknown price kind', () => {
    expect(errorsOf('widget;P1;;;;;1;;fixed;10', 'product;P1;;;;;1;;cheap;10')).toEqual([
      { line: 2, column: 'kind', code: 'unknownKind', params: { value: 'widget' } },
      { line: 3, column: 'price_kind', code: 'unknownPriceKind', params: { value: 'cheap' } },
    ]);
  });

  it('asks for the key columns a kind needs and refuses those it does not take', () => {
    expect(
      errorsOf(
        'product;;;;;;1;;fixed;10',
        'variant;P1;;;;;1;;fixed;10',
        'category;P1;;tools;;;1;;percent;-5',
        'category_attribute;;;tools;color;;1;;percent;-5',
        'attribute;;;;;red;1;;percent;-5',
        'all;;;;color;;1;;percent;-5',
      ),
    ).toEqual([
      { line: 2, column: 'product_sku', code: 'required', params: { kind: 'product' } },
      { line: 3, column: 'variant_sku', code: 'required', params: { kind: 'variant' } },
      { line: 4, column: 'product_sku', code: 'notAllowed', params: { kind: 'category' } },
      { line: 5, column: 'attribute_value', code: 'required', params: { kind: 'category_attribute' } },
      { line: 6, column: 'attribute_key', code: 'required', params: { kind: 'attribute' } },
      { line: 7, column: 'attribute_key', code: 'notAllowed', params: { kind: 'all' } },
    ]);
  });

  it('refuses quantities that are not whole, below 1, or a maximum below the minimum', () => {
    expect(errorsOf('product;P1;;;;;0;;fixed;10', 'product;P1;;;;;1,5;;fixed;10', 'product;P1;;;;;10;9;fixed;10', 'product;P1;;;;;;;fixed;10')).toEqual([
      { line: 2, column: 'min_quantity', code: 'minQuantity', params: { value: '0' } },
      { line: 3, column: 'min_quantity', code: 'notAnInteger', params: { value: '1,5' } },
      { line: 4, column: 'max_quantity', code: 'maxBelowMin', params: { min: 10, max: 9 } },
      { line: 5, column: 'min_quantity', code: 'required', params: { kind: 'product' } },
    ]);
  });

  it('refuses values each price kind cannot take', () => {
    expect(
      errorsOf(
        'product;P1;;;;;1;;fixed;abc',
        'product;P1;;;;;1;;fixed;-5',
        'product;P1;;;;;1;;fixed;1,23456',
        'product;P1;;;;;1;;percent;20',
        'product;P1;;;;;1;;percent;-5,123',
        'product;P1;;;;;1;;percent;+1001',
        'product;P1;;;;;1;;amount;12345678901',
        'product;P1;;;;;1;;fixed;',
      ),
    ).toEqual([
      { line: 2, column: 'value', code: 'notANumber', params: { value: 'abc' } },
      { line: 3, column: 'value', code: 'negative', params: { value: '-5' } },
      { line: 4, column: 'value', code: 'tooManyDecimals', params: { value: '1,23456', max: 4 } },
      { line: 5, column: 'value', code: 'percentNeedsSign', params: { value: '20' } },
      { line: 6, column: 'value', code: 'tooManyDecimals', params: { value: '-5,123', max: 2 } },
      { line: 7, column: 'value', code: 'percentOutOfRange', params: { value: '+1001', min: -100, max: 1000 } },
      { line: 8, column: 'value', code: 'tooLarge', params: { value: '12345678901' } },
      { line: 9, column: 'value', code: 'required', params: { kind: 'product' } },
    ]);
  });

  it('keeps the readable lines of a file with refused ones', () => {
    const result = parsed(file('product;P1;;;;;1;;fixed;10', 'widget;;;;;;1;;fixed;1', 'product;P2;;;;;1;;fixed;20'));
    expect(result.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(result.errors.map((e) => e.line)).toEqual([3]);
  });
});

describe('the server’s refusals, mapped back to file lines and columns', () => {
  const result = parsed(
    file(
      'product;NOPE;;;;;1;;fixed;10',
      'variant;P1;P9-RED;;;;1;;fixed;10',
      'variant;P2;P1-RED;;;;1;;fixed;10',
      'category;;;nowhere;;;1;;percent;-5',
      'attribute;;;;color;teal;1;;percent;-5',
      'attribute;;;;size;xl;1;;percent;-5',
      'attribute;;;;eco;maybe;1;;percent;-5',
      'all;;;;;;1;;fixed;10',
      'product;P1;;;;;1;;fixed;10',
      'product;P1;;;;;5;;fixed;9',
      'product;P2;;;;;1;;fixed;10',
    ),
  );
  const ROW_A = '00000000-0000-4000-8000-00000000000a';
  const ROW_B = '00000000-0000-4000-8000-00000000000b';
  const STORED = '00000000-0000-4000-8000-00000000000c';
  const T = 'PRICE_BOOK_ROW_TARGET' as const;
  const S = 'PRICE_BOOK_ROW_SHAPE' as const;

  it('names the line, the column and the rule of each, by the server’s reason code (Checkpoint 11 ruling 2)', () => {
    const resolved = result.rows.map((_, i) => (i === 8 ? ({ id: ROW_A } as never) : i === 9 ? ({ id: ROW_B } as never) : null));
    expect(
      serverLineErrors(
        [
          { index: 0, field: 'key.productSku', code: T, reason: 'product_unknown', message: 'English, for logs' },
          { index: 1, field: 'key.variantSku', code: T, reason: 'variant_unknown', message: 'x' },
          { index: 2, field: 'key.productSku', code: T, reason: 'variant_other_product', message: 'x' },
          { index: 3, field: 'key.categoryPath', code: T, reason: 'category_unknown', message: 'x' },
          { index: 4, field: 'key.attribute', code: T, reason: 'attribute_value_unknown', message: 'x' },
          { index: 5, field: 'key.attribute', code: T, reason: 'attribute_not_selectable', message: 'x' },
          { index: 6, field: 'key.attribute', code: T, reason: 'attribute_value_boolean', message: 'x' },
          { index: 7, field: 'price.type', code: S, reason: 'fixed_on_all', message: 'x' },
          { index: 9, rowId: ROW_A, field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP', reason: 'rows_overlap', message: 'x' },
          { index: 8, rowId: STORED, field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP', reason: 'rows_overlap', message: 'x' },
          { index: 10, field: 'selection', code: S, reason: 'base_book_kind', message: 'x' },
          { index: 10, field: 'price.type', code: S, reason: 'base_product_fixed', message: 'x' },
          { index: 10, field: 'selection', code: S, reason: 'selection_combined', message: 'x' },
          { index: 10, field: 'maxQuantity', code: S, reason: 'max_below_min', message: 'x' },
          { index: 10, field: 'price.amount', code: S, reason: 'row_invalid', message: 'x' },
          { field: 'upsert', code: 'PRICE_BOOK_ROW_LIMIT', reason: 'book_row_limit', message: 'x' },
        ],
        result.rows,
        resolved,
      ),
    ).toEqual([
      { line: 2, column: 'product_sku', code: 'unknownProduct', params: { value: 'NOPE' } },
      { line: 3, column: 'variant_sku', code: 'unknownVariant', params: { value: 'P9-RED' } },
      { line: 4, column: 'product_sku', code: 'variantOfOtherProduct', params: { variant: 'P1-RED', product: 'P2' } },
      { line: 5, column: 'category_path', code: 'unknownCategory', params: { value: 'nowhere' } },
      { line: 6, column: 'attribute_value', code: 'attributeValueUnknown', params: { key: 'color', value: 'teal' } },
      { line: 7, column: 'attribute_key', code: 'attributeNotSelectable', params: { key: 'size', value: 'xl' } },
      { line: 8, column: 'attribute_value', code: 'attributeValueBoolean', params: { key: 'eco', value: 'maybe' } },
      { line: 9, column: 'price_kind', code: 'fixedOnAll', params: {} },
      { line: 11, column: 'min_quantity', code: 'overlapsLine', params: { other: 10 } },
      { line: 10, column: 'min_quantity', code: 'overlapsStored', params: {} },
      { line: 12, column: 'kind', code: 'baseBookKind', params: {} },
      { line: 12, column: 'price_kind', code: 'baseProductFixed', params: {} },
      { line: 12, column: 'kind', code: 'selectionCombined', params: {} },
      { line: 12, column: 'max_quantity', code: 'maxBelowMin', params: { min: 1, max: '' } },
      { line: 12, column: 'value', code: 'rowInvalid', params: {} },
      { line: null, column: null, code: 'bookLimit', params: { max: PRICE_BOOK_MAX_ROWS } },
    ]);
  });

  it('never quotes the server’s English: a refusal without a reason is named by its group code', () => {
    expect(serverLineErrors([{ index: 0, field: 'price', code: S, message: 'English' }], result.rows, [])).toEqual([
      { line: 2, column: 'value', code: 'refusedGroup', params: { code: S } },
    ]);
  });
});

describe('the refused rows, downloaded', () => {
  it('writes exactly the refused lines in the same format with a reason column', () => {
    const result = parsed(file('product;P1;;;;;1;;fixed;10', 'widget;;;;;;1;;fixed;1'));
    const text = refusedRowsCsv(
      [{ cells: result.lines.find((l) => l.line === 3)!.cells, reason: 'Unknown kind “widget”.' }],
      'en',
    );
    expect(text.slice(1).split('\r\n')).toEqual([`${EN_HEADER};reason`, 'widget;;;;;;1;;fixed;1;Unknown kind “widget”.', '']);
    expect(refusedRowsCsv([], 'pl').slice(1).split('\r\n')[0]).toBe(`${PL_HEADER};powod`);
  });
});

describe('performance', () => {
  it('parses a 5 000-row file within the budget in the header', () => {
    const lines = Array.from({ length: PRICE_BOOK_MAX_ROWS }, (_, i) => `product;SKU-${i};;;;;1;;fixed;${i},50`);
    const text = file(...lines);
    const started = performance.now();
    const result = parsed(text);
    const elapsed = performance.now() - started;
    expect(result.rows).toHaveLength(PRICE_BOOK_MAX_ROWS);
    expect(elapsed).toBeLessThan(1000);
  });
});
