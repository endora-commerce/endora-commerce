import {
  PRICE_BOOK_MAX_ROWS,
  PRICE_BOOK_PERCENT_MAX,
  PRICE_BOOK_PERCENT_MIN,
  slugify,
  type PriceBookBatchRowInput,
  type PriceBookNaturalKey,
  type PriceBookRow,
  type PriceBookRowError,
  type PriceBookRowErrorReason,
  type PriceBookRowPrice,
  type PriceBookSelectionKind,
} from '@endora-commerce/contracts';
import { readDecimalText } from './price-cell.js';

/**
 * The price-book CSV codec (feature 161, T092; FR-018, FR-038, FR-039;
 * `contracts/csv-format.md`). One fixed format for export and import, so an
 * exported file re-imports unchanged (SC-009).
 *
 * Pure: no React, no DOM, no translation — every refusal is a code with its
 * parameters, translated by the screen, and every line refusal names its file
 * line and its column. The import never decides what the server will accept
 * beyond the file's own syntax: unknown SKUs, overlaps and a book's rules come
 * back from the server's preview (`serverLineErrors`).
 */

export type CsvLanguage = 'en' | 'pl';
export type CsvEncoding = 'utf-8' | 'windows-1250';
export type CsvSeparator = ';' | ',';

/** A file over this is refused before it is read (FR-039). */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;
/** Rows per exported file, and data lines per imported one: one batch (`PRICE_BOOK_MAX_ROWS`). */
export const CSV_MAX_ROWS = PRICE_BOOK_MAX_ROWS;

export const CSV_COLUMNS = [
  'kind',
  'product_sku',
  'variant_sku',
  'category_path',
  'attribute_key',
  'attribute_value',
  'min_quantity',
  'max_quantity',
  'price_kind',
  'value',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

const POLISH_COLUMNS: Record<CsvColumn, string> = {
  kind: 'rodzaj',
  product_sku: 'sku_produktu',
  variant_sku: 'sku_wariantu',
  category_path: 'sciezka_kategorii',
  attribute_key: 'kod_atrybutu',
  attribute_value: 'wartosc_atrybutu',
  min_quantity: 'od_ilosci',
  max_quantity: 'do_ilosci',
  price_kind: 'typ_ceny',
  value: 'wartosc',
};
/** The optional last column of a refused-rows file; ignored on import. */
const REASON_COLUMN: Record<CsvLanguage, string> = { en: 'reason', pl: 'powod' };

const KINDS: Record<CsvLanguage, Record<PriceBookSelectionKind, string>> = {
  en: { all: 'all', attribute: 'attribute', category: 'category', category_attribute: 'category_attribute', product: 'product', variant: 'variant' },
  pl: { all: 'wszystkie', attribute: 'atrybut', category: 'kategoria', category_attribute: 'kategoria_atrybut', product: 'produkt', variant: 'wariant' },
};
type PriceKind = PriceBookRowPrice['type'];
const PRICE_KINDS: Record<CsvLanguage, Record<PriceKind, string>> = {
  en: { fixed: 'fixed', percent: 'percent', amount: 'amount' },
  pl: { fixed: 'stala', percent: 'procent', amount: 'kwota' },
};

/** The key columns each kind needs; every other key column must be empty. */
const KEY_COLUMNS: Record<PriceBookSelectionKind, readonly CsvColumn[]> = {
  all: [],
  attribute: ['attribute_key', 'attribute_value'],
  category: ['category_path'],
  category_attribute: ['category_path', 'attribute_key', 'attribute_value'],
  product: ['product_sku'],
  // The product SKU of a variant is optional; when given, the server checks it.
  variant: ['variant_sku'],
};
const OPTIONAL_KEY_COLUMNS: Partial<Record<PriceBookSelectionKind, readonly CsvColumn[]>> = { variant: ['product_sku'] };
const ALL_KEY_COLUMNS: readonly CsvColumn[] = ['product_sku', 'variant_sku', 'category_path', 'attribute_key', 'attribute_value'];

export function csvHeader(language: CsvLanguage): string[] {
  return CSV_COLUMNS.map((column) => columnHeader(column, language));
}

export function columnHeader(column: CsvColumn, language: CsvLanguage): string {
  return language === 'pl' ? POLISH_COLUMNS[column] : column;
}

// ---- Export ----------------------------------------------------------------------

/** What a row must carry to be exported — a `PriceBookRow` is one. */
export type CsvExportRow = Pick<PriceBookRow, 'selectionKind' | 'naturalKey' | 'minQuantity' | 'maxQuantity' | 'price'>;

const BOM = '﻿';
const EOL = '\r\n';

/** One file: a BOM, the header, one CRLF-terminated line per row, `;`-separated. */
export function exportCsv(rows: readonly CsvExportRow[], language: CsvLanguage): string {
  const lines = [csvHeader(language), ...rows.map((row) => exportCells(row, language))];
  return BOM + lines.map((cells) => cells.map((cell) => quote(cell, ';')).join(';')).join(EOL) + EOL;
}

function exportCells(row: CsvExportRow, language: CsvLanguage): string[] {
  const key = row.naturalKey;
  return [
    KINDS[language][row.selectionKind],
    key.productSku ?? '',
    key.variantSku ?? '',
    key.categoryPath ?? '',
    key.attribute?.key ?? '',
    key.attribute?.valueCode ?? '',
    String(row.minQuantity),
    row.maxQuantity === null ? '' : String(row.maxQuantity),
    PRICE_KINDS[language][row.price.type],
    exportValue(row.price, language),
  ];
}

/** Two decimal places at least, the stored precision at most; a percentage and an adjustment signed. */
function exportValue(price: PriceBookRowPrice, language: CsvLanguage): string {
  const separator = language === 'pl' ? ',' : '.';
  const raw = price.type === 'percent' ? price.percent : price.amount;
  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const digits = fraction.replace(/0+$/, '').padEnd(2, '0');
  const body = `${whole}${separator}${digits}`;
  if (price.type === 'fixed') return body;
  if (/^0+[.,]0+$/.test(body)) return price.type === 'percent' ? body : `+${body}`;
  return `${negative ? '-' : '+'}${body}`;
}

function quote(cell: string, separator: CsvSeparator): string {
  return cell.includes(separator) || cell.includes('"') || cell.includes('\n') || cell.includes('\r')
    ? `"${cell.replaceAll('"', '""')}"`
    : cell;
}

/** `<book>-<YYYY-MM-DD>-<language>.csv`, numbered `-<i>-of-<n>` when a view needs several files. */
export function exportFileName(
  bookName: string,
  date: Date,
  language: CsvLanguage,
  part?: { readonly index: number; readonly count: number },
): string {
  const day = date.toISOString().slice(0, 10);
  const numbered = part && part.count > 1 ? `-${part.index}-of-${part.count}` : '';
  return `${slugify(bookName, { fallback: 'price-book' })}-${day}-${language}${numbered}.csv`;
}

/** A view as files of at most `CSV_MAX_ROWS` rows, each a complete file with its header. */
export function exportFiles(
  rows: readonly CsvExportRow[],
  options: { readonly bookName: string; readonly date: Date; readonly language: CsvLanguage },
): Array<{ readonly name: string; readonly content: string }> {
  const count = Math.max(1, Math.ceil(rows.length / CSV_MAX_ROWS));
  return Array.from({ length: count }, (_, i) => ({
    name: exportFileName(options.bookName, options.date, options.language, { index: i + 1, count }),
    content: exportCsv(rows.slice(i * CSV_MAX_ROWS, (i + 1) * CSV_MAX_ROWS), options.language),
  }));
}

/** The refused lines in the same format, with a reason column (FR-041). */
export function refusedRowsCsv(lines: ReadonlyArray<{ readonly cells: readonly string[]; readonly reason: string }>, language: CsvLanguage): string {
  const all = [[...csvHeader(language), REASON_COLUMN[language]], ...lines.map((l) => [...l.cells.slice(0, CSV_COLUMNS.length), l.reason])];
  return BOM + all.map((cells) => cells.map((cell) => quote(cell, ';')).join(';')).join(EOL) + EOL;
}

// ---- Import: bytes -----------------------------------------------------------------

export type CsvFileError =
  | { readonly code: 'tooLarge'; readonly maxBytes: number }
  | { readonly code: 'empty' }
  | { readonly code: 'tooManyRows'; readonly max: number; readonly count: number }
  | { readonly code: 'unknownColumns'; readonly columns: readonly string[] }
  | { readonly code: 'duplicateColumns'; readonly columns: readonly string[] }
  | { readonly code: 'missingColumns'; readonly columns: readonly string[] }
  | { readonly code: 'columnOrder'; readonly expected: readonly string[] }
  | { readonly code: 'unclosedQuote'; readonly line: number };

/** A file over 5 MB, refused before it is read. */
export function fileSizeRefusal(size: number): CsvFileError | null {
  return size > CSV_MAX_BYTES ? { code: 'tooLarge', maxBytes: CSV_MAX_BYTES } : null;
}

/**
 * The file's text. Without a choice, strict UTF-8 first (a BOM is dropped);
 * when the bytes are not UTF-8 they are read as Windows-1250 and the answer
 * says it is `uncertain`, so the screen asks the administrator (FR-039). A
 * choice is honoured as given.
 */
export function decodeCsv(bytes: Uint8Array, encoding?: CsvEncoding): { text: string; encoding: CsvEncoding; uncertain: boolean } {
  if (encoding !== undefined) {
    return { text: stripBom(new TextDecoder(encoding).decode(bytes)), encoding, uncertain: false };
  }
  try {
    return { text: stripBom(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), encoding: 'utf-8', uncertain: false };
  } catch {
    return { text: stripBom(new TextDecoder('windows-1250').decode(bytes)), encoding: 'windows-1250', uncertain: true };
  }
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

// ---- Import: text --------------------------------------------------------------------

export type CsvLineErrorCode =
  // Local, from the file's syntax.
  | 'columnCount'
  | 'unknownKind'
  | 'required'
  | 'notAllowed'
  | 'notAnInteger'
  | 'minQuantity'
  | 'maxBelowMin'
  | 'unknownPriceKind'
  | 'notANumber'
  | 'negative'
  | 'tooManyDecimals'
  | 'tooLarge'
  | 'percentNeedsSign'
  | 'percentOutOfRange'
  // From the server's preview, one per `reason` of `PRICE_BOOK_ROW_ERROR_REASONS`.
  | 'rowInvalid'
  | 'selectionCombined'
  | 'fixedOnAll'
  | 'variantNeedsProduct'
  | 'baseBookKind'
  | 'baseProductFixed'
  | 'unknownProduct'
  | 'unknownVariant'
  | 'variantOfOtherProduct'
  | 'unknownCategory'
  | 'attributeNotSelectable'
  | 'attributeValueUnknown'
  | 'attributeValueBoolean'
  | 'rowNotInBook'
  | 'overlapsLine'
  | 'overlapsStored'
  | 'bookLimit'
  // A refusal from a server that names no reason: its group code, translated.
  | 'refusedGroup';

export interface CsvLineError {
  /** The file line (the header is line 1); `null` only for a refusal of the whole book. */
  readonly line: number | null;
  readonly column: CsvColumn | null;
  readonly code: CsvLineErrorCode;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface CsvLine {
  readonly line: number;
  readonly cells: readonly string[];
}

export interface CsvRow extends CsvLine {
  readonly input: PriceBookBatchRowInput;
}

export interface CsvParsed {
  readonly ok: true;
  readonly separator: CsvSeparator;
  readonly headerLanguage: CsvLanguage;
  /** Every non-empty data line, readable or not (for the refused-rows download). */
  readonly lines: readonly CsvLine[];
  /** The readable lines, in file order — the batch's `upsert`, index for index. */
  readonly rows: readonly CsvRow[];
  readonly errors: readonly CsvLineError[];
}

export function parseCsv(input: string): CsvParsed | { readonly ok: false; readonly error: CsvFileError } {
  const text = stripBom(input);
  const firstBreak = text.search(/\r?\n/);
  const headerText = firstBreak === -1 ? text : text.slice(0, firstBreak);
  if (headerText.trim() === '') return { ok: false, error: { code: 'empty' } };
  const separator: CsvSeparator = headerText.includes(';') ? ';' : ',';

  const records = splitRecords(text, separator);
  if ('unclosedQuote' in records) return { ok: false, error: { code: 'unclosedQuote', line: records.unclosedQuote } };
  const [header, ...data] = records.records;
  const headerCheck = readHeader(header!.cells);
  if ('error' in headerCheck) return { ok: false, error: headerCheck.error };

  const lines = data.filter((record) => record.cells.some((cell) => cell.trim() !== ''));
  if (lines.length > CSV_MAX_ROWS) return { ok: false, error: { code: 'tooManyRows', max: CSV_MAX_ROWS, count: lines.length } };

  const rows: CsvRow[] = [];
  const errors: CsvLineError[] = [];
  for (const record of lines) {
    const result = readLine(record, headerCheck.width);
    if ('error' in result) errors.push(result.error);
    else rows.push({ ...record, input: result.input });
  }
  return { ok: true, separator, headerLanguage: headerCheck.language, lines, rows, errors };
}

/** RFC 4180 records with the file line each starts on. */
function splitRecords(text: string, separator: CsvSeparator): { records: CsvLine[] } | { unclosedQuote: number } {
  const records: CsvLine[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let quoteLine = 1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      quoteLine = line;
      cell = '';
    } else if (ch === separator) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = [];
      cell = '';
      line += 1;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (quoted) return { unclosedQuote: quoteLine };
  if (cell !== '' || cells.length > 0) {
    cells.push(cell);
    records.push({ line: recordLine, cells });
  }
  return { records };
}

function readHeader(cells: readonly string[]): { width: number; language: CsvLanguage } | { error: CsvFileError } {
  const names = cells.map((cell) => cell.trim().toLowerCase());
  const known = new Map<string, { column: CsvColumn | 'reason'; language: CsvLanguage }>();
  for (const column of CSV_COLUMNS) {
    known.set(column, { column, language: 'en' });
    known.set(POLISH_COLUMNS[column], { column, language: 'pl' });
  }
  known.set(REASON_COLUMN.en, { column: 'reason', language: 'en' });
  known.set(REASON_COLUMN.pl, { column: 'reason', language: 'pl' });

  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) return { error: { code: 'unknownColumns', columns: unknown } };
  const columns = names.map((name) => known.get(name)!.column);
  const duplicated = [...new Set(names.filter((_name, i) => columns.indexOf(columns[i]!) !== i))];
  if (duplicated.length > 0) return { error: { code: 'duplicateColumns', columns: duplicated } };
  const language: CsvLanguage = known.get(names[0]!)?.language ?? 'en';
  const missing = CSV_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) return { error: { code: 'missingColumns', columns: missing.map((c) => columnHeader(c, language)) } };
  const reasonAt = columns.indexOf('reason');
  const inOrder = CSV_COLUMNS.every((column, i) => columns[i] === column) && (reasonAt === -1 || reasonAt === CSV_COLUMNS.length);
  if (!inOrder) return { error: { code: 'columnOrder', expected: csvHeader(language) } };
  return { width: columns.length, language };
}

const KIND_ALIASES = aliasMap(KINDS);
const PRICE_KIND_ALIASES = aliasMap(PRICE_KINDS);

function aliasMap<K extends string>(names: Record<CsvLanguage, Record<K, string>>): Map<string, K> {
  const out = new Map<string, K>();
  for (const language of ['en', 'pl'] as const) {
    for (const [value, name] of Object.entries(names[language]) as Array<[K, string]>) out.set(name, value);
  }
  return out;
}

type LineResult = { input: PriceBookBatchRowInput } | { error: CsvLineError };

function readLine(record: CsvLine, width: number): LineResult {
  const { line } = record;
  const fail = (column: CsvColumn | null, code: CsvLineErrorCode, params: Record<string, string | number> = {}): LineResult => ({
    error: { line, column, code, params },
  });
  if (record.cells.length !== width && record.cells.length !== CSV_COLUMNS.length) {
    return fail(null, 'columnCount', { expected: CSV_COLUMNS.length, found: record.cells.length });
  }
  const cell = (column: CsvColumn): string => record.cells[CSV_COLUMNS.indexOf(column)]!.trim();

  const kindText = cell('kind');
  const kind = KIND_ALIASES.get(kindText.toLowerCase());
  if (kind === undefined) return kindText === '' ? fail('kind', 'required', { kind: '' }) : fail('kind', 'unknownKind', { value: kindText });

  for (const column of KEY_COLUMNS[kind]) if (cell(column) === '') return fail(column, 'required', { kind });
  const allowed = new Set([...KEY_COLUMNS[kind], ...(OPTIONAL_KEY_COLUMNS[kind] ?? [])]);
  for (const column of ALL_KEY_COLUMNS) if (!allowed.has(column) && cell(column) !== '') return fail(column, 'notAllowed', { kind });

  const minText = cell('min_quantity');
  if (minText === '') return fail('min_quantity', 'required', { kind });
  if (!/^\d+$/.test(minText)) return fail('min_quantity', 'notAnInteger', { value: minText });
  const minQuantity = Number(minText);
  if (minQuantity < 1) return fail('min_quantity', 'minQuantity', { value: minText });
  const maxText = cell('max_quantity');
  let maxQuantity: number | null = null;
  if (maxText !== '') {
    if (!/^\d+$/.test(maxText)) return fail('max_quantity', 'notAnInteger', { value: maxText });
    maxQuantity = Number(maxText);
    if (maxQuantity < minQuantity) return fail('max_quantity', 'maxBelowMin', { min: minQuantity, max: maxQuantity });
  }

  const priceKindText = cell('price_kind');
  const priceKind = PRICE_KIND_ALIASES.get(priceKindText.toLowerCase());
  if (priceKind === undefined) {
    return priceKindText === '' ? fail('price_kind', 'required', { kind }) : fail('price_kind', 'unknownPriceKind', { value: priceKindText });
  }
  const valueText = cell('value');
  if (valueText === '') return fail('value', 'required', { kind });
  const price = readPrice(priceKind, valueText);
  if ('code' in price) return fail('value', price.code, { value: valueText, ...price.params });

  const key: PriceBookNaturalKey = {};
  if (cell('product_sku')) key.productSku = cell('product_sku');
  if (cell('variant_sku')) key.variantSku = cell('variant_sku');
  if (cell('category_path')) key.categoryPath = cell('category_path');
  if (cell('attribute_key')) key.attribute = { key: cell('attribute_key'), valueCode: cell('attribute_value') };
  return { input: { key, minQuantity, maxQuantity, price } };
}

type PriceRead = PriceBookRowPrice | { code: CsvLineErrorCode; params: Record<string, string | number> };

function readPrice(kind: PriceKind, text: string): PriceRead {
  const number = readDecimalText(text.replace(/%\s*$/, ''));
  if (number === null) return { code: 'notANumber', params: {} };
  const { sign, whole, fraction } = number;
  const zero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  if (kind === 'percent') {
    if (fraction.length > 2) return { code: 'tooManyDecimals', params: { max: 2 } };
    if (!zero && sign === '') return { code: 'percentNeedsSign', params: {} };
    const value = Number(`${sign === '-' ? '-' : ''}${whole}.${fraction || '0'}`);
    if (whole.length > 4 || value < PRICE_BOOK_PERCENT_MIN || value > PRICE_BOOK_PERCENT_MAX) {
      return { code: 'percentOutOfRange', params: { min: PRICE_BOOK_PERCENT_MIN, max: PRICE_BOOK_PERCENT_MAX } };
    }
    return { type: 'percent', percent: `${sign === '-' && !zero ? '-' : ''}${whole}.${fraction.padEnd(2, '0')}` };
  }
  if (fraction.length > 4) return { code: 'tooManyDecimals', params: { max: 4 } };
  if (whole.length > 10) return { code: 'tooLarge', params: {} };
  const digits = `${whole}.${fraction.padEnd(4, '0')}`;
  if (kind === 'fixed') {
    if (sign === '-' && !zero) return { code: 'negative', params: {} };
    return { type: 'fixed', amount: digits };
  }
  return { type: 'amount', amount: `${sign === '-' && !zero ? '-' : ''}${digits}` };
}

// ---- The server's preview, back on file lines ----------------------------------------

const SERVER_COLUMN: ReadonlyArray<readonly [RegExp, CsvColumn | null]> = [
  [/^key\.productSku/, 'product_sku'],
  [/^key\.variantSku/, 'variant_sku'],
  [/^key\.categoryPath/, 'category_path'],
  [/^key\.attribute/, 'attribute_value'],
  [/^minQuantity/, 'min_quantity'],
  [/^maxQuantity/, 'max_quantity'],
  [/^price\.type/, 'price_kind'],
  [/^price/, 'value'],
  [/^(selection|key)/, 'kind'],
];

/** The server's rule code as the file refusal the screen translates (Checkpoint 11 ruling 2). */
const REASON_CODE: Record<PriceBookRowErrorReason, CsvLineErrorCode> = {
  row_invalid: 'rowInvalid',
  selection_combined: 'selectionCombined',
  max_below_min: 'maxBelowMin',
  fixed_on_all: 'fixedOnAll',
  variant_needs_product: 'variantNeedsProduct',
  base_book_kind: 'baseBookKind',
  base_product_fixed: 'baseProductFixed',
  product_unknown: 'unknownProduct',
  variant_unknown: 'unknownVariant',
  variant_other_product: 'variantOfOtherProduct',
  category_unknown: 'unknownCategory',
  attribute_not_selectable: 'attributeNotSelectable',
  attribute_value_unknown: 'attributeValueUnknown',
  attribute_value_boolean: 'attributeValueBoolean',
  row_not_in_book: 'rowNotInBook',
  rows_overlap: 'overlapsStored',
  book_row_limit: 'bookLimit',
};

/**
 * The preview's `errors[]` as file refusals: `index` is the row's position in
 * the batch, which is `rows`' order; the rule is the server's `reason` code,
 * never its English `message`. An overlap names the other line when it is in
 * the file (`resolved` holds the ids the batch's rows took).
 */
export function serverLineErrors(
  errors: readonly PriceBookRowError[],
  rows: readonly CsvRow[],
  resolved: ReadonlyArray<{ readonly id?: string | undefined } | null>,
): CsvLineError[] {
  return errors.map((error): CsvLineError => {
    if (error.reason === 'book_row_limit' || error.code === 'PRICE_BOOK_ROW_LIMIT') {
      return { line: null, column: null, code: 'bookLimit', params: { max: PRICE_BOOK_MAX_ROWS } };
    }
    const row = error.index === undefined ? undefined : rows[error.index];
    let column = SERVER_COLUMN.find(([pattern]) => pattern.test(error.field))?.[1] ?? null;
    if (error.reason === undefined) {
      return { line: row?.line ?? null, column: row ? column : null, code: 'refusedGroup', params: { code: error.code } };
    }
    if (!row) return { line: null, column: null, code: REASON_CODE[error.reason], params: {} };
    const key = row.input.key ?? {};
    const attribute = { key: key.attribute?.key ?? '', value: key.attribute?.valueCode ?? '' };
    let params: Record<string, string | number> = {};
    let code = REASON_CODE[error.reason];
    switch (error.reason) {
      case 'product_unknown':
        params = { value: key.productSku ?? '' };
        break;
      case 'variant_unknown':
        params = { value: key.variantSku ?? '' };
        break;
      case 'variant_other_product':
        params = { variant: key.variantSku ?? '', product: key.productSku ?? '' };
        break;
      case 'category_unknown':
        params = { value: key.categoryPath ?? '' };
        break;
      case 'attribute_not_selectable':
        column = 'attribute_key';
        params = attribute;
        break;
      case 'attribute_value_unknown':
      case 'attribute_value_boolean':
        params = attribute;
        break;
      case 'max_below_min':
        params = { min: row.input.minQuantity, max: row.input.maxQuantity ?? '' };
        break;
      case 'rows_overlap': {
        const other = error.rowId === undefined ? -1 : resolved.findIndex((r) => r?.id === error.rowId);
        if (other >= 0 && rows[other]) {
          code = 'overlapsLine';
          params = { other: rows[other]!.line };
        }
        break;
      }
      default:
        break;
    }
    return { line: row.line, column, code, params };
  });
}
