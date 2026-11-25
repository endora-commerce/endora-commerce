import {
  DOCUMENT_POSITION_FIELD,
  ITEMS_TABLE_LIMITS,
  documentCellLink,
  documentFieldPathRe,
  documentSectionTexts,
  documentValueHasValue,
  evaluateDocumentCondition,
  formatDocumentValue,
  isValidSectionPartition,
  itemsTableGroupingMode,
  resolveDocumentAlign,
  sumDocumentValues,
  type DocumentAlign,
  type DocumentFieldDefinition,
  type DocumentItem,
  type DocumentItemSection,
  type DocumentRenderContext,
  type DocumentValue,
  type DocumentValueFormat,
} from '@endora-commerce/contracts';
import type { CollectionCatalogue } from '../registry/document-type-registry.js';
import { bool, color, num, str, type Props } from './props.js';

/**
 * `document_templates.ItemsTable` — the **Line items table**
 * (`specs/153-quote-request-pdf-template/contracts/document-collections.md` §3.2,
 * §3.3; research R-8, R-9).
 *
 * Prints a document's lines as a real pdfmake table whose columns the template
 * defines: the header row repeats on every page (`headerRows: 1`), a line's row
 * never splits across pages (`dontBreakRows`), fixed widths over the page are
 * scaled down. Optional: a detail row under each line, grouping with subtotals,
 * and a separate totals table under it.
 *
 * Every value is formatted by the shared `formatDocumentValue` and every rule
 * evaluated by `evaluateDocumentCondition` from `@endora-commerce/contracts`,
 * the same functions the editor canvas uses, so the canvas shows what the PDF
 * prints (FR-036). Props were validated at save; here they are read tolerantly
 * — a value of the wrong type falls back to its default, an unreadable rule
 * reads as *always* — because a stored template may predate a rule.
 *
 * A line and its detail row are not kept together across a page break: pdfmake
 * keeps one row unbroken, not two, and the `pageBreakBefore` hook that could do
 * it re-lays the whole document per node. That is a SHOULD of the contract and
 * is verified by eye in the quickstart, not promised here. A section's heading
 * row (feature 159) is in the same position — it can close a page with the
 * section's first line opening the next — and stays a documented limitation for
 * the same reason (`specs/159-quote-request-item-groups/research.md` N-28).
 *
 * **Sections** (feature 159, `specs/159-quote-request-item-groups/contracts/document-sections.md`
 * §3): with the grouping setting on *Document's groups* — which is what `null`
 * and an absent setting mean — and a document holding at least one group, each
 * section prints a heading row, its rows and the table's own totals rows over
 * the section's totals. A document without a group, a partition the table
 * cannot use, *No grouping* and grouping *by field* print exactly as 153 did.
 */

export interface ItemsTableInput {
  readonly props: Props;
  readonly catalogue: CollectionCatalogue;
  /** The collection's items, already numbered (`numberItems`). */
  readonly items: readonly DocumentItem[];
  readonly summary: Readonly<Record<string, DocumentValue>>;
  /** Feature 159 — the collection's sections, when the document type declares them. */
  readonly sections?: readonly DocumentItemSection[];
  readonly language: string;
  readonly context: DocumentRenderContext;
  readonly interpolate: (text: string) => string;
}

interface Column {
  readonly field: string;
  readonly label: string;
  readonly width: 'auto' | 'fill' | number;
  readonly align: 'auto' | DocumentAlign;
  readonly format: DocumentValueFormat;
  readonly emptyText: string;
  readonly visibleWhen: unknown;
  /** Issue #1904 — the raw option; `documentCellLink` reads it. */
  readonly link: unknown;
}

/** A linked cell's colour — the comparison share link's (`comparisons.ComparisonShareLink`). */
const LINK_COLOR = '#1d4ed8';

interface Cell {
  text: string;
  [key: string]: unknown;
}

/** `row.number` 1…n in item order — over the whole table; grouping does not restart it. */
export function numberItems(items: readonly DocumentItem[]): DocumentItem[] {
  return items.map((item, index) => ({
    values: { ...item.values, [DOCUMENT_POSITION_FIELD]: { kind: 'number', value: index + 1 } },
  }));
}

/** A preview's items with each field's `sampleValue` where the sample has no value (research R-4). */
export function withSampleValues(
  items: readonly DocumentItem[],
  fields: readonly DocumentFieldDefinition[],
): DocumentItem[] {
  const samples = fields.filter((field) => field.sampleValue !== undefined && field.sampleValue !== null);
  if (samples.length === 0) return [...items];
  return items.map((item) => {
    const values: Record<string, DocumentValue> = { ...item.values };
    for (const field of samples) {
      if (!documentValueHasValue(values[field.path])) values[field.path] = field.sampleValue!;
    }
    return { values };
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fieldOf(raw: unknown): string {
  return typeof raw === 'string' && documentFieldPathRe.test(raw) ? raw : '';
}

function formatOf(raw: unknown): DocumentValueFormat {
  const f = record(raw);
  if (!f) return {};
  const out: { decimals?: number; currencyDisplay?: 'symbol' | 'code' | 'none'; dateStyle?: 'short' | 'medium' | 'long' } = {};
  if (typeof f['decimals'] === 'number' && Number.isInteger(f['decimals']) && f['decimals'] >= 0 && f['decimals'] <= 4) {
    out.decimals = f['decimals'];
  }
  if (f['currencyDisplay'] === 'symbol' || f['currencyDisplay'] === 'code' || f['currencyDisplay'] === 'none') {
    out.currencyDisplay = f['currencyDisplay'];
  }
  if (f['dateStyle'] === 'short' || f['dateStyle'] === 'medium' || f['dateStyle'] === 'long') {
    out.dateStyle = f['dateStyle'];
  }
  return out;
}

function widthOf(raw: unknown): Column['width'] {
  if (raw === 'auto' || raw === 'fill') return raw;
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(value) ? Math.min(400, Math.max(10, value)) : 'auto';
}

function readColumns(raw: unknown): Column[] {
  if (!Array.isArray(raw)) return [];
  const out: Column[] = [];
  for (const candidate of raw.slice(0, ITEMS_TABLE_LIMITS.maxColumns)) {
    const c = record(candidate);
    if (!c) continue;
    const align = c['align'];
    out.push({
      field: fieldOf(c['field']),
      label: typeof c['label'] === 'string' ? c['label'] : '',
      width: widthOf(c['width']),
      align: align === 'left' || align === 'center' || align === 'right' ? align : 'auto',
      format: formatOf(c['format']),
      emptyText: typeof c['emptyText'] === 'string' ? c['emptyText'] : '',
      visibleWhen: c['visibleWhen'],
      link: c['link'],
    });
  }
  return out;
}

/** Columns: *never* hides; *any line has a value* hides when none has; anything else shows (FR-033). */
function columnVisible(column: Column, items: readonly DocumentItem[], known: boolean): boolean {
  const op = record(column.visibleWhen)?.['op'];
  if (op === 'never') return false;
  if (op === 'any_has_value') {
    if (!known && !record(column.visibleWhen)?.['field']) return false;
    return evaluateDocumentCondition(column.visibleWhen, { items }, column.field);
  }
  return true;
}

/** Detail entries and totals rows: *never* hides, *always* shows, anything else needs a value. */
function entryVisible(rule: unknown, holds: () => boolean): boolean {
  const op = record(rule)?.['op'];
  if (op === 'never') return false;
  if (op === 'always') return true;
  return holds();
}

function scaleWidths(columns: readonly Column[], pageWidth: number): (string | number)[] {
  const fixed = columns.reduce((sum, column) => sum + (typeof column.width === 'number' ? column.width : 0), 0);
  const factor = fixed > pageWidth && fixed > 0 ? pageWidth / fixed : 1;
  return columns.map((column) =>
    column.width === 'auto'
      ? 'auto'
      : column.width === 'fill'
        ? '*'
        : Math.floor(column.width * factor * 100) / 100,
  );
}

/** Placeholder cells pdfmake needs after a `colSpan` cell. */
const spanned = (count: number): Cell[] => Array.from({ length: Math.max(0, count) }, () => ({ text: '' }));

export function renderItemsTable(input: ItemsTableInput): Record<string, unknown> {
  const { props, catalogue, language, context, interpolate } = input;
  const byPath = new Map(catalogue.fields.map((field) => [field.path, field]));
  const summaryByPath = new Map(catalogue.summaryFields.map((field) => [field.path, field]));
  const items = context.preview ? withSampleValues(input.items, catalogue.fields) : [...input.items];

  const fontSize = num(props, 'fontSize', 9, 6, 14);
  const headerBackground = color(props, 'headerBackground', '#f1f5f9');
  const borderColor = color(props, 'borderColor', '#cbd5e1') ?? '#cbd5e1';
  const stripedRows = bool(props, 'stripedRows', false);
  const stripeColor = color(props, 'stripeColor', '#f8fafc');
  const marginBottom = num(props, 'marginBottom', 12, 0, 144);
  const emptyNode = { text: interpolate(str(props, 'emptyText', '')) };

  const columns = readColumns(props['columns']).filter((column) =>
    columnVisible(column, items, column.field !== '' && byPath.has(column.field)),
  );

  const stack: Record<string, unknown>[] = [];
  if (columns.length === 0 || items.length === 0) {
    stack.push(emptyNode);
  } else {
    const sections = printedSections(props['grouping'], input.sections, items.length);
    stack.push(
      buildTable({
        columns,
        items,
        byPath,
        props,
        language,
        interpolate,
        context,
        fontSize,
        headerBackground,
        borderColor,
        stripedRows,
        stripeColor,
        ...(sections ? { sections, summaryByPath } : {}),
      }),
    );
  }

  const totals = buildTotals(props['totals'], input.summary, summaryByPath, language, interpolate, borderColor);
  if (totals) stack.push(totals);

  return { stack, margin: [0, 0, 0, marginBottom] };
}

/**
 * The sections this table prints, or `null` to print as 153 did: the setting
 * is *Document's groups*, the type declared sections, at least one is a group,
 * and the partition covers the lines (contract §1, §3).
 */
function printedSections(
  grouping: unknown,
  sections: readonly DocumentItemSection[] | undefined,
  itemCount: number,
): { readonly list: readonly DocumentItemSection[]; readonly otherItemsLabel: string; readonly showItemCount: boolean } | null {
  if (itemsTableGroupingMode(grouping) !== 'sections') return null;
  if (!sections || !sections.some((section) => section.kind === 'group')) return null;
  if (!isValidSectionPartition(sections, itemCount)) return null;
  const options = record(grouping) ?? {};
  return {
    list: sections,
    otherItemsLabel: str(options, 'otherItemsLabel', ''),
    showItemCount: bool(options, 'showItemCount', true),
  };
}

interface TableInput {
  readonly columns: readonly Column[];
  readonly items: readonly DocumentItem[];
  readonly byPath: ReadonlyMap<string, DocumentFieldDefinition>;
  readonly props: Props;
  readonly language: string;
  readonly interpolate: (text: string) => string;
  readonly context: DocumentRenderContext;
  readonly fontSize: number;
  readonly headerBackground: string | undefined;
  readonly borderColor: string;
  readonly stripedRows: boolean;
  readonly stripeColor: string | undefined;
  readonly sections?: NonNullable<ReturnType<typeof printedSections>>;
  readonly summaryByPath?: ReadonlyMap<string, DocumentFieldDefinition>;
}

function buildTable(t: TableInput): Record<string, unknown> {
  const n = t.columns.length;
  const alignOf = (column: Column, value?: DocumentValue): DocumentAlign => {
    const field = t.byPath.get(column.field);
    return resolveDocumentAlign(column.align, field?.defaultAlign, field?.valueKind ?? value?.kind);
  };
  const cellText = (column: Column, item: DocumentItem): string => {
    const field = t.byPath.get(column.field);
    if (!field) return column.emptyText;
    const value = item.values[column.field];
    if (!documentValueHasValue(value)) return column.emptyText;
    return formatDocumentValue(value, { ...(field.defaultFormat ?? {}), ...column.format }, t.language);
  };

  const header: Cell[] = t.columns.map((column) => {
    const label = column.label.trim() !== '' ? t.interpolate(column.label) : (t.byPath.get(column.field)?.label ?? '');
    return {
      text: label,
      bold: true,
      alignment: alignOf(column),
      ...(t.headerBackground ? { fillColor: t.headerBackground } : {}),
    };
  });

  const detail = record(t.props['detailRow']);
  const detailEnabled = detail ? bool(detail, 'enabled', false) : false;
  const detailEntries = detailEnabled && Array.isArray(detail?.['entries'])
    ? (detail!['entries'] as unknown[]).slice(0, ITEMS_TABLE_LIMITS.maxDetailEntries).map(record).filter((e): e is Record<string, unknown> => e !== null)
    : [];
  const detailSeparator = detail ? str(detail, 'separator', ' · ') : ' · ';
  const detailItalics = detail ? bool(detail, 'italics', true) : true;
  const detailFontSize = detail ? num(detail, 'fontSize', 8, 6, 14) : 8;

  const detailRow = (item: DocumentItem): Cell[] | null => {
    const parts: string[] = [];
    for (const entry of detailEntries) {
      const path = fieldOf(entry['field']);
      const field = path ? t.byPath.get(path) : undefined;
      if (!field) continue;
      const value = item.values[path];
      if (!documentValueHasValue(value)) continue;
      if (!entryVisible(entry['visibleWhen'], () => evaluateDocumentCondition(entry['visibleWhen'], { item }, path))) continue;
      const formatted = formatDocumentValue(value, field.defaultFormat ?? {}, t.language);
      const label = typeof entry['label'] === 'string' ? t.interpolate(entry['label']) : '';
      parts.push(label.trim() !== '' ? `${label}: ${formatted}` : formatted);
    }
    if (parts.length === 0) return null;
    return [
      { text: parts.join(detailSeparator), colSpan: n, italics: detailItalics, fontSize: detailFontSize, color: '#475569' },
      ...spanned(n - 1),
    ];
  };

  let stripe = 0;
  const itemRows = (item: DocumentItem): Cell[][] => {
    const fill = t.stripedRows && stripe % 2 === 1 && t.stripeColor ? { fillColor: t.stripeColor } : {};
    stripe += 1;
    const rows: Cell[][] = [
      t.columns.map((column) => {
        const cell: Cell = { text: cellText(column, item), alignment: alignOf(column, item.values[column.field]), ...fill };
        // Issue #1904 — only a cell that prints its value links; the empty text never does.
        const url = documentValueHasValue(item.values[column.field])
          ? documentCellLink(column.link, t.byPath.get(column.field), item)
          : null;
        return url ? { ...cell, link: url, color: LINK_COLOR } : cell;
      }),
    ];
    const extra = detailRow(item);
    if (extra) rows.push(extra);
    return rows;
  };

  const body: Cell[][] = [header];
  const grouping = record(t.props['grouping']);
  const groupField = grouping && itemsTableGroupingMode(grouping) === 'field' ? fieldOf(grouping['field']) : '';
  if (t.sections) {
    const texts = documentSectionTexts(t.language);
    const otherItems = t.interpolate(t.sections.otherItemsLabel);
    for (const section of t.sections.list) {
      const name = section.kind === 'group' ? (section.label ?? '') : otherItems.trim() !== '' ? otherItems : texts.otherItems;
      body.push([
        {
          text: t.sections.showItemCount ? `${name} · ${texts.itemCount(section.itemIndexes.length)}` : name,
          colSpan: n,
          bold: true,
          ...(t.headerBackground ? { fillColor: t.headerBackground } : {}),
        },
        ...spanned(n - 1),
      ]);
      for (const index of section.itemIndexes) body.push(...itemRows(t.items[index]!));
      for (const row of totalsRows(t.props['totals'], section.summary, t.summaryByPath ?? new Map(), t.language, t.interpolate)) {
        body.push(
          n >= 2
            ? [{ text: row.label, colSpan: n - 1, alignment: 'right' }, ...spanned(n - 2), { text: row.value, alignment: 'right' }]
            : [{ text: [row.label, row.value].filter((part) => part !== '').join(' '), alignment: 'right' }],
        );
      }
    }
  } else if (grouping && groupField) {
    const emptyLabel = str(grouping, 'emptyLabel', '');
    const subtotalField = fieldOf(grouping['subtotalField']);
    const subtotalLabel = t.interpolate(str(grouping, 'subtotalLabel', ''));
    const groups = new Map<string, DocumentItem[]>();
    for (const item of t.items) {
      const value = item.values[groupField];
      const key = documentValueHasValue(value) ? formatDocumentValue(value, {}, t.language) : emptyLabel;
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
    const subtotalColumn = t.columns.find((column) => column.field === subtotalField);
    const subtotalFormat = { ...(t.byPath.get(subtotalField)?.defaultFormat ?? {}), ...(subtotalColumn?.format ?? {}) };
    for (const [key, members] of groups) {
      body.push([
        {
          text: key,
          colSpan: n,
          bold: true,
          ...(t.headerBackground ? { fillColor: t.headerBackground } : {}),
        },
        ...spanned(n - 1),
      ]);
      for (const item of members) body.push(...itemRows(item));
      if (subtotalField) {
        const sum = sumDocumentValues(members.map((item) => item.values[subtotalField]));
        const value = formatDocumentValue(sum, subtotalFormat, t.language);
        body.push(
          n >= 2
            ? [
                { text: subtotalLabel, colSpan: n - 1, bold: true, alignment: 'right' },
                ...spanned(n - 2),
                { text: value, bold: true, alignment: 'right' },
              ]
            : [{ text: [subtotalLabel, value].filter((part) => part !== '').join(' '), bold: true, alignment: 'right' }],
        );
      }
    }
  } else {
    for (const item of t.items) body.push(...itemRows(item));
  }

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: scaleWidths(t.columns, t.context.pageWidth),
      body,
    },
    fontSize: t.fontSize,
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => t.borderColor,
      vLineColor: () => t.borderColor,
    },
  };
}

/**
 * The totals rows whose rule holds over `summary` — the document's totals, or
 * one section's (feature 159): same labels, same rules, same formatting.
 */
function totalsRows(
  raw: unknown,
  summary: Readonly<Record<string, DocumentValue>>,
  byPath: ReadonlyMap<string, DocumentFieldDefinition>,
  language: string,
  interpolate: (text: string) => string,
): { label: string; value: string; emphasis: boolean }[] {
  if (!Array.isArray(raw)) return [];
  const rows: { label: string; value: string; emphasis: boolean }[] = [];
  for (const candidate of raw.slice(0, ITEMS_TABLE_LIMITS.maxTotals)) {
    const entry = record(candidate);
    if (!entry) continue;
    const path = fieldOf(entry['field']);
    const field = path ? byPath.get(path) : undefined;
    // A row naming a field the catalogue no longer offers has no value (FR-037).
    const value = field ? summary[path] : null;
    if (!entryVisible(entry['visibleWhen'], () => field !== undefined && evaluateDocumentCondition(entry['visibleWhen'] ?? { op: 'has_value' }, { summary }, path))) {
      continue;
    }
    const label = typeof entry['label'] === 'string' && entry['label'].trim() !== '' ? interpolate(entry['label']) : (field?.label ?? '');
    rows.push({ label, value: formatDocumentValue(value, field?.defaultFormat ?? {}, language), emphasis: bool(entry, 'emphasis', false) });
  }
  return rows;
}

function buildTotals(
  raw: unknown,
  summary: Readonly<Record<string, DocumentValue>>,
  byPath: ReadonlyMap<string, DocumentFieldDefinition>,
  language: string,
  interpolate: (text: string) => string,
  borderColor: string,
): Record<string, unknown> | null {
  const rows: Cell[][] = totalsRows(raw, summary, byPath, language, interpolate).map(({ label, value, emphasis }) => {
    const cell = (text: string, alignment: DocumentAlign): Cell => ({
      text,
      alignment,
      ...(emphasis ? { bold: true, border: [false, true, false, false] } : { border: [false, false, false, false] }),
    });
    return [cell(label, 'right'), cell(value, 'right')];
  });
  if (rows.length === 0) return null;
  return {
    unbreakable: true,
    margin: [0, 6, 0, 0],
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        table: { widths: ['auto', 'auto'], body: rows },
        layout: {
          hLineWidth: () => 0.75,
          vLineWidth: () => 0,
          hLineColor: () => borderColor,
        },
      },
    ],
  };
}
