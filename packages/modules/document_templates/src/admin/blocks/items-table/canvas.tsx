import type { CSSProperties, ReactNode } from 'react';
import {
  DOCUMENT_POSITION_FIELD,
  documentCellLink,
  documentSectionTexts,
  documentValueHasValue,
  evaluateDocumentCondition,
  formatDocumentValue,
  isValidSectionPartition,
  itemsTableGroupingMode,
  resolveDocumentAlign,
  sumDocumentValues,
  type DocumentFieldDefinition,
  type DocumentItem,
  type DocumentValue,
  type DocumentValueFormat,
} from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useCollection, useDocumentLanguage } from './collections-context.js';
import { asList, asRecord, opOf, text, type Entry } from './shared.js';

/**
 * The Line items table on the editor's canvas
 * (`specs/153-quote-request-pdf-template/contracts/admin-ui.md` §2): an HTML
 * table drawn over the served sample with the **same** shared functions the
 * PDF uses — `formatDocumentValue`, `evaluateDocumentCondition`,
 * `sumDocumentValues` — so what the operator sees is what prints (FR-036).
 * Pagination is not imitated. A column its rule hides on this sample is drawn
 * faded with a caption, so it can still be found and selected.
 *
 * Feature 159: with *Document's groups* (the default) and a sample holding
 * groups, the sample's sections are drawn as the PDF prints them — a heading
 * row, the rows, the table's totals rows over the section's totals.
 *
 * Issue #1904 — a column printed as a link draws its linked values in the
 * PDF's link colour, the address on hover; not an anchor, so a click on the
 * canvas still selects the block rather than leaving the editor.
 *
 * Inline styles, as every document canvas renderer: the canvas is an iframe.
 */

/** The renderer's link colour (`items-table.ts`). */
const LINK_COLOR = '#1d4ed8';

type Props = Record<string, unknown>;

const colorOf = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value) ? value : fallback;
const numOf = (value: unknown, fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const flagOf = (value: unknown, fallback: boolean): boolean =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : fallback;

function formatOf(column: Entry, field: DocumentFieldDefinition | undefined): DocumentValueFormat {
  return { ...((field?.defaultFormat ?? {}) as DocumentValueFormat), ...(asRecord(column['format']) as DocumentValueFormat) };
}

export function ItemsTableCanvas(props: Props): ReactNode {
  const t = useTranslation('document_templates');
  const language = useDocumentLanguage();
  const collection = useCollection(props['collection']);
  const fontSize = numOf(props['fontSize'], 9) + 2;
  const border = colorOf(props['borderColor'], '#cbd5e1');
  const headerBackground = colorOf(props['headerBackground'], '#f1f5f9');
  const stripe = flagOf(props['stripedRows'], false) ? colorOf(props['stripeColor'], '#f8fafc') : null;
  const wrapper: CSSProperties = { margin: `0 0 ${numOf(props['marginBottom'], 12)}px`, fontFamily: 'system-ui, sans-serif', fontSize };
  if (!collection) {
    return <p style={{ ...wrapper, color: '#64748b' }}>{t('itemsTable.canvas.noCollection')}</p>;
  }
  const byPath = new Map(collection.fields.map((field) => [field.path, field]));
  const summaryByPath = new Map(collection.summaryFields.map((field) => [field.path, field]));
  const items: readonly DocumentItem[] = collection.sampleItems;
  const columns = asList(props['columns']).map((column) => {
    const path = text(column['field']);
    const op = opOf(column['visibleWhen'], 'always');
    const hidden = op === 'never' || (op === 'any_has_value' && !evaluateDocumentCondition(column['visibleWhen'], { items }, path));
    return { column, path, field: byPath.get(path), hidden };
  });
  const cellStyle = (hidden: boolean, align: CSSProperties['textAlign']): CSSProperties => ({
    border: `1px solid ${border}`,
    padding: '2px 4px',
    textAlign: align,
    opacity: hidden ? 0.35 : 1,
  });
  if (columns.length === 0 || items.length === 0) {
    return <p style={wrapper}>{text(props['emptyText'])}</p>;
  }
  const cell = (entry: (typeof columns)[number], item: DocumentItem): ReactNode => {
    if (!entry.field) return text(entry.column['emptyText']);
    const value = item.values[entry.path];
    if (!documentValueHasValue(value)) return text(entry.column['emptyText']);
    const formatted = formatDocumentValue(value, formatOf(entry.column, entry.field), language);
    const url = documentCellLink(entry.column['link'], entry.field, item);
    return url ? (
      <span data-link="true" title={url} style={{ color: LINK_COLOR }}>
        {formatted}
      </span>
    ) : (
      formatted
    );
  };
  const alignOf = (entry: (typeof columns)[number]) =>
    resolveDocumentAlign(
      (['auto', 'left', 'center', 'right'] as const).find((a) => a === entry.column['align']) ?? 'auto',
      entry.field?.defaultAlign,
      entry.field?.valueKind,
    );

  const detail = asRecord(props['detailRow']);
  const detailOn = flagOf(detail['enabled'], false);
  const detailText = (item: DocumentItem): string =>
    asList(detail['entries'])
      .flatMap((entry) => {
        const path = text(entry['field']);
        const field = byPath.get(path);
        const value = item.values[path];
        if (!field || !documentValueHasValue(value)) return [];
        const op = opOf(entry['visibleWhen'], 'has_value');
        if (op === 'never') return [];
        const formatted = formatDocumentValue(value, (field.defaultFormat ?? {}) as DocumentValueFormat, language);
        const label = text(entry['label']).trim();
        return [label ? `${label}: ${formatted}` : formatted];
      })
      .join(text(detail['separator'], ' · '));

  const totalsOf = (summary: Readonly<Record<string, DocumentValue>>) =>
    asList(props['totals']).flatMap((entry) => {
      const path = text(entry['field']);
      const field = summaryByPath.get(path);
      const value = field ? summary[path] : null;
      const op = opOf(entry['visibleWhen'], 'has_value');
      const shown = op === 'always' || (op !== 'never' && field !== undefined && documentValueHasValue(value));
      if (!shown) return [];
      return [
        {
          label: text(entry['label']).trim() || field?.label || '',
          value: formatDocumentValue(value, (field?.defaultFormat ?? {}) as DocumentValueFormat, language),
          emphasis: flagOf(entry['emphasis'], false),
        },
      ];
    });

  const span = columns.length;
  let rowIndex = 0;
  const rows: ReactNode[] = [];
  const pushItem = (item: DocumentItem): void => {
    const n = rowIndex;
    rowIndex += 1;
    const position = String(item.values[DOCUMENT_POSITION_FIELD] && (item.values[DOCUMENT_POSITION_FIELD] as { value: number }).value);
    rows.push(
      <tr key={`r:${position}:${n}`} style={stripe && n % 2 === 1 ? { background: stripe } : undefined}>
        {columns.map((entry, c) => (
          <td key={c} style={cellStyle(entry.hidden, alignOf(entry))}>
            {cell(entry, item)}
          </td>
        ))}
      </tr>,
    );
    const extra = detailOn ? detailText(item) : '';
    if (extra) {
      rows.push(
        <tr key={`d:${position}:${n}`}>
          <td colSpan={span} style={{ ...cellStyle(false, 'left'), fontStyle: 'italic', color: '#475569', fontSize: fontSize - 1 }}>
            {extra}
          </td>
        </tr>,
      );
    }
  };
  const headingRow = (key: string, label: string): ReactNode => (
    <tr key={`g:${key}`}>
      <td colSpan={span} style={{ ...cellStyle(false, 'left'), fontWeight: 700, background: headerBackground }}>
        {label}
      </td>
    </tr>
  );

  const groupingMode = itemsTableGroupingMode(props['grouping']);
  const grouping = props['grouping'] ? asRecord(props['grouping']) : null;
  const sampleSections = collection.sampleSections ?? [];
  const drawSections =
    groupingMode === 'sections' &&
    sampleSections.some((section) => section.kind === 'group') &&
    isValidSectionPartition(sampleSections, items.length);
  const groupField = grouping && groupingMode === 'field' ? text(grouping['field']) : '';
  const groups = new Map<string, DocumentItem[]>();
  for (const item of drawSections ? [] : items) {
    const value = groupField ? item.values[groupField] : null;
    const key = groupField ? (documentValueHasValue(value) ? formatDocumentValue(value, {}, language) : text(grouping?.['emptyLabel'])) : '';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  if (drawSections) {
    const texts = documentSectionTexts(language);
    const otherItems = text(grouping?.['otherItemsLabel']).trim() || texts.otherItems;
    const showItemCount = flagOf(grouping?.['showItemCount'], true);
    for (const section of sampleSections) {
      const name = section.kind === 'group' ? (section.label ?? '') : otherItems;
      rows.push(headingRow(section.key, showItemCount ? `${name} · ${texts.itemCount(section.itemIndexes.length)}` : name));
      for (const index of section.itemIndexes) pushItem(items[index]!);
      totalsOf(section.summary).forEach((row, i) => {
        rows.push(
          <tr key={`st:${section.key}:${i}`}>
            {span >= 2 ? (
              <>
                <td colSpan={span - 1} style={cellStyle(false, 'right')}>
                  {row.label}
                </td>
                <td style={cellStyle(false, 'right')}>{row.value}</td>
              </>
            ) : (
              <td style={cellStyle(false, 'right')}>{[row.label, row.value].filter(Boolean).join(' ')}</td>
            )}
          </tr>,
        );
      });
    }
  }
  for (const [key, members] of groups) {
    if (groupField) rows.push(headingRow(key, key));
    for (const item of members) pushItem(item);
    const subtotalField = grouping ? text(grouping['subtotalField']) : '';
    if (groupField && subtotalField) {
      const sum = sumDocumentValues(members.map((item) => item.values[subtotalField]));
      rows.push(
        <tr key={`s:${key}`}>
          <td colSpan={span} style={{ ...cellStyle(false, 'right'), fontWeight: 700 }}>
            {[text(grouping?.['subtotalLabel']), formatDocumentValue(sum, (byPath.get(subtotalField)?.defaultFormat ?? {}) as DocumentValueFormat, language)]
              .filter(Boolean)
              .join(' ')}
          </td>
        </tr>,
      );
    }
  }

  const totals = totalsOf(collection.sampleSummary);

  return (
    <div style={wrapper}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {columns.map((entry, c) => (
              <th key={c} scope="col" style={{ ...cellStyle(entry.hidden, alignOf(entry)), background: headerBackground }}>
                {text(entry.column['label']).trim() || entry.field?.label || ''}
                {entry.hidden ? (
                  <span style={{ display: 'block', fontWeight: 400, fontSize: fontSize - 3 }}>({t('itemsTable.canvas.hiddenInSample')})</span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      {totals.length > 0 ? (
        <table style={{ borderCollapse: 'collapse', marginLeft: 'auto', marginTop: 6 }}>
          <tbody>
            {totals.map((row, i) => (
              <tr key={i} style={row.emphasis ? { fontWeight: 700, borderTop: `1px solid ${border}` } : undefined}>
                <td style={{ padding: '2px 8px', textAlign: 'right' }}>{row.label}</td>
                <td style={{ padding: '2px 4px', textAlign: 'right' }}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
