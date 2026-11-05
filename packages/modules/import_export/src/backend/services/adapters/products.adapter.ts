import {
  ERROR_CODES,
  decodeCsvScopedCell,
  encodeCsvScopedCell,
  planLocaleWrites,
  productScopeStatusSchema,
  productVisibilitySchema,
  sameSourceLocale,
  scopedColumn,
  toScopeChannel,
  validateScopedWrite,
  type BulkImportReport,
  type BulkImportRowError,
  type CatalogProductRecord,
  type PimSourceValues,
  type ProductImportRow,
  type ProductImportCell,
  type ProductScopedWriteCell,
  type ScopedExportValue,
  type ScopeLevel,
  type ScopeRef,
  type ScopedWriteOp,
} from '@endora-commerce/contracts';
import type { AdapterImportReport, ImportExportAdapter, ImportExportPorts, ImportRowsOptions } from '../adapter.js';
import {
  PRODUCTS_CSV_CELL_MAX,
  PRODUCTS_CSV_ROWS_MAX,
  PRODUCTS_REPORT_ERRORS_MAX,
  ProductsFileError,
  isGuardedAttributeType,
  parseProductsHeader,
  type FieldInfo,
  type GrammarAttribute,
  type GrammarChannel,
  type ProductsColumn,
} from './products-csv-grammar.js';

/**
 * Products import/export (feature 174, `specs/174-product-editor-scope-switcher/contracts/`
 * `import-profiles-and-csv.md` §2–§3, `write-encoding.md`).
 *
 * The file speaks one grammar (`products-csv-grammar.ts`) and one write encoding: an empty cell
 * changes nothing, `NULL` is the deliberately empty value, `INHERIT` removes the own value, a
 * leading `\` escapes a token, and every **text** column carries the formula guard (FR-118) —
 * `encodeCsvScopedCell` on export and `decodeCsvScopedCell` on import, both here, so neither
 * ships without the other. Locale columns (`name[pl_PL]`) are mapped by the run's import
 * profile through `planLocaleWrites`; this module always hands the planner explicit ops, so a
 * source value shaped like an op is never read as one.
 *
 * `catalog` owns the write (feature 075 / D-74). Each product row is its own call of the port —
 * one transaction per product (`import-profiles-and-csv.md` §2) — and a dry run calls nothing.
 */
const EXPORT_HEADER = [
  'id',
  'sku',
  'slug',
  'type',
  'status',
  'visibility',
  'name',
  'description',
  // Coordinator ruling 2026-11-03 (`import-profiles-and-csv.md` §2.1): Global value columns.
  'minOrderQuantity',
  'returnable',
] as const;

const text = (raw: string) => encodeCsvScopedCell({ kind: 'text', text: raw });
const value = (raw: string) => encodeCsvScopedCell({ kind: 'text', text: raw }, { column: 'value' });

function exportRowOf(p: CatalogProductRecord): string[] {
  return [
    text(p.id),
    text(p.sku),
    text(p.slug),
    value(p.type),
    value(p.status),
    value(p.visibility),
    text(p.name),
    // A product without a description holds the deliberately empty Global value.
    p.description === null || p.description === undefined || p.description === ''
      ? encodeCsvScopedCell({ kind: 'empty' })
      : text(p.description),
    // No minimum is the deliberately empty value (FR-110); numbers and booleans take no guard.
    p.minOrderQuantity === null || p.minOrderQuantity === undefined
      ? encodeCsvScopedCell({ kind: 'empty' })
      : value(String(p.minOrderQuantity)),
    value(String(p.returnable)),
  ];
}

/** Whether a field's column takes the formula guard both ways — the grammar's rule (`fieldInfo.guarded`). */
function isGuardedField(field: string, attributeDefs: ReadonlyMap<string, GrammarAttribute>): boolean {
  if (field.startsWith('attribute:')) {
    const def = attributeDefs.get(field.slice('attribute:'.length));
    return def !== undefined && isGuardedAttributeType(def.valueType);
  }
  return field === 'name' || field === 'description' || field === 'urlKey';
}

/** One exported scoped cell: absent = `INHERIT`, empty = `NULL`, else the value in its column's form. */
function exportCell(own: ScopedExportValue | undefined, textColumn: boolean): string {
  if (own === undefined) return encodeCsvScopedCell({ kind: 'inherit' });
  if (own.kind === 'empty') return encodeCsvScopedCell({ kind: 'empty' });
  const raw =
    own.kind === 'text' ? own.text : Array.isArray(own.value) ? own.value.join('|') : String(own.value);
  return textColumn ? text(raw) : value(raw);
}

/**
 * Feature 172 (`specs/172-product-content-attributes/`, FR-041 import) — a Page Builder content
 * attribute is authored on the product content screen only, so a cell under its
 * `attribute:<key>` column is refused, whatever it holds, as a field error naming the column; the
 * row's other cells still apply. Its value type comes with the attribute read the header grammar
 * already makes, so the check costs no call of its own.
 */
const CONTENT_ATTRIBUTE_REFUSAL = 'content_attribute';
const isContentColumn = (info: FieldInfo): boolean => info.valueType === 'page_builder';

type CellRead = { kind: 'no_change' } | { kind: 'op'; op: ScopedWriteOp<unknown> } | { kind: 'error'; code: string };

/** The op a cell carries for its field, or why it carries none (`write-encoding.md` §3, §3a). */
export function readProductsCell(info: FieldInfo, raw: string): CellRead {
  if (raw.length > PRODUCTS_CSV_CELL_MAX) return { kind: 'error', code: 'too_long' };
  const cell = decodeCsvScopedCell(info.text ? raw : raw.trim(), { column: info.guarded ? 'text' : 'value' });
  if (cell.kind === 'no_change') return { kind: 'no_change' };
  if (cell.kind === 'empty') return { kind: 'op', op: { op: 'empty' } };
  if (cell.kind === 'inherit') return { kind: 'op', op: { op: 'inherit' } };
  // A lone `'` decodes to empty text, which has no CSV form (`write-encoding.md` §2): refused,
  // never guessed as "no change" or as the empty value.
  if (cell.text === '') return { kind: 'error', code: 'invalid' };
  switch (info.valueType) {
    case 'status': {
      const parsed = productScopeStatusSchema.safeParse(cell.text);
      return parsed.success ? { kind: 'op', op: { op: 'set', value: parsed.data } } : { kind: 'error', code: 'invalid' };
    }
    case 'number':
    case 'price': {
      const number = Number(cell.text);
      return Number.isFinite(number) ? { kind: 'op', op: { op: 'set', value: number } } : { kind: 'error', code: 'invalid' };
    }
    case 'boolean': {
      const lowered = cell.text.toLowerCase();
      if (lowered !== 'true' && lowered !== 'false') return { kind: 'error', code: 'invalid' };
      return { kind: 'op', op: { op: 'set', value: lowered === 'true' } };
    }
    case 'multiselect':
      return { kind: 'op', op: { op: 'set', value: cell.text.split('|').map((part) => part.trim()) } };
    default:
      return { kind: 'op', op: { op: 'set', value: cell.text } };
  }
}

const levelOf = (scope: ScopeRef): ScopeLevel =>
  scope.level === 'global' ? 'G' : scope.level === 'channel' ? 'C' : 'CL';

function cellKey(field: string, scope: ScopeRef): string {
  if (scope.level === 'global') return `${field}@G`;
  if (scope.level === 'channel') return `${field}@${scope.channelId}`;
  return `${field}@${scope.channelId}/${scope.languageCode.toLowerCase()}`;
}

const groupKey = (locale: string, sourceChannel: string | null) =>
  `${locale.toLowerCase().replace(/-/g, '_')}|${sourceChannel ?? ''}`;

type LocaleColumn = Extract<ProductsColumn, { kind: 'locale' }>;

export function productsAdapter(ports: ImportExportPorts): ImportExportAdapter {
  async function channels(): Promise<GrammarChannel[]> {
    // The languages a channel offers: its list, and its default language always (`toScopeChannel`).
    return (await ports.salesChannels.listAll()).map((c) => ({ id: c.id, code: c.code, languages: toScopeChannel(c).languages }));
  }

  async function attributes(): Promise<Map<string, GrammarAttribute>> {
    const all = await ports.catalogAttributes.listAll();
    return new Map(
      all.map((a) => [a.key, { key: a.key, valueType: a.valueType, scopable: a.scopable, isRequired: a.isRequired }]),
    );
  }

  return {
    name: 'products',
    owners: ['catalog'],
    exportPermission: 'catalog:read',
    importPermission: 'catalog:write',
    requiresProfile: true,
    exportHeader: EXPORT_HEADER,

    // The fixed Global columns, then one `<field>@<channel code>[/<language>]` column per
    // (field, scope) at which any product holds an own value (`import-profiles-and-csv.md` §3):
    // the own value there, `NULL` for a deliberately empty one, `INHERIT` where the product
    // inherits (FR-043). Text columns carry the formula guard exactly where the import strips
    // it, so importing the file unchanged changes nothing (FR-114, FR-118).
    async exportTable() {
      const [products, scoped, attributeDefs] = await Promise.all([
        ports.catalogProducts.listAll(),
        ports.catalogBulkImport.exportScopedValues(),
        attributes(),
      ]);
      const columns = scoped.columns.map((c) => ({
        key: scopedColumn(c.field, c.channelCode, c.languageCode),
        text: isGuardedField(c.field, attributeDefs),
      }));
      return {
        header: [...EXPORT_HEADER, ...columns.map((c) => c.key)],
        rows: products.map((p) => {
          const values = scoped.values[p.id] ?? {};
          return [...exportRowOf(p), ...columns.map((c) => exportCell(values[c.key], c.text))];
        }),
      };
    },

    async exportRows(): Promise<string[][]> {
      return (await ports.catalogProducts.listAll()).map(exportRowOf);
    },

    importHeader: ['sku'] as const,
    // Feature 160 (FR-043) — a product has no price of its own; prices are set
    // in price books. A file still carrying a price column is refused rather
    // than imported without it.
    refusedHeader: ['default_price', 'defaultPrice', 'price', 'price_override', 'priceOverride'].map((column) => ({
      column,
      code: ERROR_CODES.PRICE_SET_IN_PRICE_BOOKS,
      message: 'Prices are set in price books, not on the product: remove the price column.',
    })),

    async importRows(records, options?: ImportRowsOptions): Promise<AdapterImportReport> {
      const profile = options?.profile;
      if (profile === undefined) throw new Error('A products import runs with a profile.');
      if (records.length > PRODUCTS_CSV_ROWS_MAX) {
        throw new ProductsFileError([`The file has ${records.length} rows; at most ${PRODUCTS_CSV_ROWS_MAX} are accepted.`]);
      }
      const allChannels = await channels();
      const header = options?.header ?? Object.keys(records[0] ?? {});
      const parsed = parseProductsHeader(header, { channels: allChannels, attributes: await attributes() });
      if (!parsed.ok) throw new ProductsFileError(parsed.errors);
      const columns = parsed.columns;
      const localeColumns = columns.filter((c): c is LocaleColumn => c.kind === 'locale');

      // Bounded lists (`PRODUCTS_REPORT_ERRORS_MAX`): every refusal is counted, the first ones listed.
      const errors: BulkImportRowError[] = [];
      const fieldErrors: NonNullable<BulkImportReport['fieldErrors']> = [];
      let errorTotal = 0;
      let fieldErrorTotal = 0;
      const rowError = (error: BulkImportRowError): void => {
        errorTotal += 1;
        if (errors.length < PRODUCTS_REPORT_ERRORS_MAX) errors.push(error);
      };
      const listFieldError = (error: NonNullable<BulkImportReport['fieldErrors']>[number]): void => {
        fieldErrorTotal += 1;
        if (fieldErrors.length < PRODUCTS_REPORT_ERRORS_MAX) fieldErrors.push(error);
      };
      const counts = new Map<string, { null: number; inherit: number }>();
      const unmapped = new Map<string, { locale: string; sourceChannel: string | null; products: number }>();
      const count = (column: string, op: ScopedWriteOp<unknown>) => {
        if (op.op === 'set') return;
        const entry = counts.get(column) ?? { null: 0, inherit: 0 };
        if (op.op === 'empty') entry.null += 1;
        else entry.inherit += 1;
        counts.set(column, entry);
      };
      const skuOf = (record: Readonly<Record<string, string>>): string => {
        const cell = decodeCsvScopedCell(record['sku'] ?? '');
        return cell.kind === 'text' ? cell.text.trim() : '';
      };

      // The products' channel memberships, for the targets the profile names (FR-042).
      const skus = [...new Set(records.map(skuOf).filter((sku) => sku !== ''))];
      const found = skus.length > 0 && localeColumns.length > 0 ? await ports.catalogProducts.findBySkus(skus) : [];
      const idBySku = new Map(found.map((p) => [p.sku, p.id]));
      const members = new Map<string, Set<string>>();
      for (const channelId of new Set(profile.localeMapping.flatMap((e) => e.targets.map((t) => t.channelId)))) {
        if (found.length === 0 || !allChannels.some((c) => c.id === channelId)) continue;
        const described = await ports.catalogAvailability.describeChannelAvailability(
          found.map((p) => p.id),
          channelId,
        );
        members.set(channelId, new Set(described.keys()));
      }

      const rows: Array<{ index: number; row: ProductImportRow }> = [];
      for (const [index, record] of records.entries()) {
        const sku = skuOf(record);
        if (!sku) {
          rowError({ index, reason: 'sku is required' });
          continue;
        }
        const row: ProductImportRow = { sku };
        const cells: ProductImportCell[] = [];
        const explicit = new Set<string>();
        const fieldError = (column: string, code: string) => listFieldError({ index, column, code });
        const take = (
          scope: ScopeRef,
          field: ProductScopedWriteCell['field'],
          op: ScopedWriteOp<unknown>,
          column?: string,
        ) => {
          // The Global status is the product row's (catalog's import of today's file).
          if (field === 'status' && scope.level === 'global' && op.op === 'set') {
            row.status = op.value as NonNullable<ProductImportRow['status']>;
            return;
          }
          // The file column rides along, so catalog's per-cell refusals name it (`fieldErrors`).
          cells.push(column === undefined ? { scope, field, op } : { scope, field, op, column });
        };

        for (const column of columns) {
          const raw = record[column.header] ?? '';
          if (column.kind === 'visibility') {
            const cell = decodeCsvScopedCell(raw.trim(), { column: 'value' });
            if (cell.kind === 'no_change') continue;
            if (cell.kind === 'empty') fieldError(column.header, 'not_emptyable');
            else if (cell.kind === 'inherit') fieldError(column.header, 'inherit_at_global');
            else {
              const visibility = productVisibilitySchema.safeParse(cell.text);
              if (visibility.success) row.visibility = visibility.data;
              else fieldError(column.header, 'invalid');
            }
            continue;
          }
          if (column.kind !== 'scoped') continue;
          if (isContentColumn(column.info)) {
            if (raw.trim() !== '') fieldError(column.header, CONTENT_ATTRIBUTE_REFUSAL);
            continue;
          }
          const read = readProductsCell(column.info, raw);
          if (read.kind === 'no_change') continue;
          if (read.kind === 'error') {
            fieldError(column.header, read.code);
            continue;
          }
          count(column.header, read.op);
          const refusal = validateScopedWrite(column.info.spec, read.op, levelOf(column.scope));
          if (refusal !== null) {
            fieldError(column.header, refusal);
            continue;
          }
          explicit.add(cellKey(column.info.field, column.scope));
          take(column.scope, column.info.field, read.op, column.header);
        }

        // Locale columns, through the profile (`pim-locale-mapping.md` §2).
        const groups = new Map<string, PimSourceValues['perLocale'][number]>();
        for (const column of localeColumns) {
          if (isContentColumn(column.info)) {
            if ((record[column.header] ?? '').trim() !== '') fieldError(column.header, CONTENT_ATTRIBUTE_REFUSAL);
            continue;
          }
          const read = readProductsCell(column.info, record[column.header] ?? '');
          if (read.kind === 'no_change') continue;
          if (read.kind === 'error') {
            fieldError(column.header, read.code);
            continue;
          }
          count(column.header, read.op);
          const toGlobal =
            profile.sourceLanguageForGlobal !== null && sameSourceLocale(profile.sourceLanguageForGlobal, column.locale);
          const refusal = validateScopedWrite(column.info.spec, read.op, toGlobal ? 'G' : 'CL');
          if (refusal !== null) {
            fieldError(column.header, refusal);
            continue;
          }
          const key = groupKey(column.locale, column.sourceChannel);
          const group = groups.get(key) ?? { locale: column.locale, sourceChannel: column.sourceChannel, values: {} };
          // Always an explicit op: a source value is never inspected for an op shape.
          group.values[column.info.field] = read.op;
          groups.set(key, group);
        }

        if (groups.size > 0) {
          const productId = idBySku.get(sku);
          const plan = planLocaleWrites({
            source: { global: {}, perLocale: [...groups.values()] },
            mapping: { sourceLanguageForGlobal: profile.sourceLanguageForGlobal, entries: profile.localeMapping },
            validScopes: {
              channels: allChannels
                .filter((channel) => productId !== undefined && members.get(channel.id)?.has(productId) === true)
                .map((channel) => ({ channelId: channel.id, languages: channel.languages })),
            },
          });
          for (const group of plan.unmapped) {
            const key = groupKey(group.locale, group.sourceChannel);
            const entry = unmapped.get(key) ?? { locale: group.locale, sourceChannel: group.sourceChannel, products: 0 };
            entry.products += 1;
            unmapped.set(key, entry);
          }
          for (const skipped of plan.skipped) {
            const target = skipped.scope.level === 'channel_language' ? skipped.scope : null;
            const header = localeColumns.find((column) =>
              profile.localeMapping.some(
                (entry) =>
                  sameSourceLocale(entry.sourceLocale, column.locale) &&
                  entry.targets.some((t) => t.channelId === target?.channelId && t.languageCode === target?.languageCode),
              ),
            )?.header;
            fieldError(header ?? 'sku', skipped.reason);
          }
          const conflict = plan.writes.find((write) => explicit.has(cellKey(write.field, write.scope)));
          if (conflict !== undefined) {
            rowError({
              index,
              reason: `IMPORT_CELL_CONFLICT: "${conflict.field}" is written by a scope column and by a mapped locale column`,
            });
            continue;
          }
          for (const write of plan.writes) take(write.scope, write.field, write.op);
        }

        if (cells.length > 0) row.cells = cells;
        if (row.cells === undefined && row.status === undefined && row.visibility === undefined) continue;
        rows.push({ index, row });
      }

      const extras = {
        cellCounts: [...counts.entries()].map(([column, c]) => ({ column, null: c.null, inherit: c.inherit })),
        warnings: [...unmapped.values()].map((u) => ({ kind: 'unmapped_locale' as const, ...u })),
        fieldErrors,
      };
      const dryRun = options?.dryRun === true;

      // One product, one call: each row is its own transaction (per-product atomicity). A dry run
      // makes the same calls with `dryRun`, so catalog's own refusals are in its report too and
      // nothing is written.
      let imported = 0;
      for (const { index, row } of rows) {
        const report = await ports.catalogBulkImport.importProducts([row], dryRun ? { dryRun: true } : undefined);
        imported += report.imported;
        for (const error of report.errors) rowError({ index, reason: error.reason });
        for (const error of report.fieldErrors ?? []) listFieldError({ ...error, index });
      }
      errors.sort((a, b) => a.index - b.index);
      const truncated =
        errorTotal > errors.length || fieldErrorTotal > fieldErrors.length
          ? { truncated: { errors: errorTotal, fieldErrors: fieldErrorTotal } }
          : {};
      return { imported, errors, ...extras, ...truncated };
    },
  };
}
