import {
  unitPriceDisplayText,
  unitPriceFractionDigits,
  type ComparisonAttributeRow,
  type ComparisonProductSummary,
} from '@endora-commerce/contracts';
import { filterRowsByMode, localisedIn } from '../../services/comparison-pdf-shared.js';
import { bool, color, num, str } from '../props.js';
import type { ComparisonBlockRenderer } from '../types.js';

/**
 * `comparisons.ComparisonTable` — one column per product, one row per compared
 * attribute, exactly the rows the buyer's screen shows: the display mode, then
 * the *Hide empty rows* switch (FR-020). Products are split across tables of
 * `productsPerTable` columns, the attribute column repeated, and a product is
 * never split. Names and amounts are printed in the PDF's language (FR-022).
 * A product the buyer may not see is not in the data at all; the table may
 * say how many there are (FR-021).
 */

function visibleRows(rows: ComparisonAttributeRow[], mode: Parameters<typeof filterRowsByMode>[1], hideEmpty: boolean) {
  const shown = filterRowsByMode(rows, mode);
  return hideEmpty ? shown.filter((row) => row.values.some((value) => value !== null && value !== '')) : shown;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A product's price is a unit price: its significant places, up to four (owner ruling of 2026-10-25). */
function money(amount: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: unitPriceFractionDigits(amount),
    }).format(amount);
  } catch {
    return `${unitPriceDisplayText(amount)} ${currency}`;
  }
}

export const comparisonTableBlock: ComparisonBlockRenderer = {
  name: 'comparisons.ComparisonTable',
  moduleId: 'comparisons',
  render({ props, data, prepared, language, interpolate }) {
    const view = data.view;
    const fontSize = num(props, 'fontSize', 9, 6, 16);
    const emptyValue = str(props, 'emptyValue', '—');
    const highlight = bool(props, 'highlightRows', true);
    const commonColor = color(props, 'commonColor', '#f0fdf4');
    const differentColor = color(props, 'differentColor', '#fef2f2');
    const headerBackground = color(props, 'headerBackground', '#f1f5f9');
    const borderColor = color(props, 'borderColor', '#cbd5e1');
    const imageSize = num(props, 'imageSize', 80, 40, 200);
    const perTable = Math.round(num(props, 'productsPerTable', 4, 1, 8));
    const rows = visibleRows(view.comparableAttributes, view.displayMode, data.hideEmptyRows);

    const productCell = (product: ComparisonProductSummary): Record<string, unknown> => {
      const stack: Record<string, unknown>[] = [];
      const image = prepared?.images.get(product.id);
      if (bool(props, 'showImages', true) && image) {
        stack.push({ image, fit: [imageSize, imageSize], alignment: 'center', margin: [0, 0, 0, 4] });
      }
      if (bool(props, 'showName', true)) stack.push({ text: product.name, bold: true }); // 168-shim: the summary name is the effective string
      if (bool(props, 'showSku', false)) stack.push({ text: product.sku, color: '#475569' });
      if (bool(props, 'showPrice', true)) {
        stack.push({ text: product.price ? money(product.price.amount, product.price.currency, language) : emptyValue });
      }
      if (bool(props, 'showAvailability', false)) {
        stack.push({
          text: product.available ? str(props, 'availableText', 'Available') : str(props, 'unavailableText', 'Unavailable'),
          color: product.available ? '#166534' : '#991b1b',
        });
      }
      return { stack, alignment: 'center', fillColor: headerBackground };
    };

    const tables = chunk(view.products, perTable).map((products, index) => {
      const columns = products.map((product) => view.products.indexOf(product));
      const header = [
        { text: interpolate(str(props, 'attributeColumnLabel', 'Attribute')), bold: true, fillColor: headerBackground },
        ...products.map(productCell),
      ];
      const body = rows.map((row) => {
        const fill = highlight ? (row.rowClass === 'common' ? commonColor : differentColor) : undefined;
        return [
          { text: localisedIn(row.label, language), bold: true, ...(fill ? { fillColor: fill } : {}) },
          ...columns.map((column) => ({
            text: row.values[column] ?? emptyValue,
            ...(fill ? { fillColor: fill } : {}),
          })),
        ];
      });
      return {
        table: { headerRows: 1, widths: ['*', ...products.map(() => '*')], body: [header, ...body] },
        layout: {
          hLineColor: (): string => borderColor,
          vLineColor: (): string => borderColor,
          hLineWidth: (): number => 0.5,
          vLineWidth: (): number => 0.5,
          paddingTop: (): number => 4,
          paddingBottom: (): number => 4,
        },
        fontSize,
        margin: [0, index === 0 ? 0 : 12, 0, 0],
      };
    });

    const stack: Record<string, unknown>[] = [...tables];
    if (bool(props, 'showHiddenNote', true) && view.hiddenProductCount > 0) {
      const text = str(props, 'hiddenNoteText', '{{hiddenCount}} product(s) of this comparison are not available to you.');
      stack.push({
        text: interpolate(text.replace(/\{\{\s*hiddenCount\s*\}\}/g, String(view.hiddenProductCount))),
        italics: true,
        color: '#475569',
        fontSize: Math.max(6, fontSize - 1),
        margin: [0, 6, 0, 0],
      });
    }
    return { stack, margin: [0, 0, 0, 12] };
  },
};
