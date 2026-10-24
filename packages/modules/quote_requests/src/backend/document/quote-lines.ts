import {
  arrangeLineGroups,
  decimalProduct,
  DOCUMENT_UNGROUPED_SECTION_KEY,
  grossFromNetHalfUp,
  lineAmountHalfUp,
  moneyDifference,
  moneySum,
  quotientHalfUp,
  roundHalfUp,
  taxAmountHalfUp,
} from '@endora-commerce/contracts';
import type {
  CatalogAttributeView,
  DocumentCollectionDeclaration,
  DocumentFieldDefinition,
  DocumentItem,
  DocumentItemSection,
  DocumentValue,
  DocumentValueKind,
  QuoteRequestDocumentData,
} from '@endora-commerce/contracts';
import { localized, quoteDocumentTexts } from './texts.js';

/**
 * The quote's **line collection** `lines` — the field catalogue a Line items
 * table chooses its columns from, and every value derived from the quote's own
 * data (`specs/153-quote-request-pdf-template/research.md` R-11,
 * `data-model.md` §4.2).
 *
 * Pure: the items and the totals are functions of `QuoteRequestDocumentData`,
 * which the data builder assembled under the requesting administrator's
 * visibility; nothing here reads anything.
 *
 * - **List price** is feature 146's reference price — the customer's price
 *   captured when the line was requested. A **discount** exists only where the
 *   agreed price is lower than the list price in the same currency; otherwise
 *   the discount fields have **no value** (never `0`), so a column shown "only
 *   if any line has a value" disappears when nobody got one (owner's example).
 * - **Totals** follow the quote screens' rule: computed only when every line
 *   has an agreed price; VAT from the net total at the quote's one rate; gross
 *   = net + VAT. Lines in different currencies have no money total.
 * - List price and the discount fields are **internal** (owner answer Q7): the
 *   editor warns on a column that prints one.
 */

export const QUOTE_LINES_COLLECTION = 'lines';

// Exact decimal arithmetic (issue #417): every amount is computed on the
// decimals it is written as and rounded half-up once; each result is a
// two-place decimal, which a number holds losslessly.
const round2 = (value: number | string): number => Number(roundHalfUp(value));
const money = (amount: number | string, currency: string): DocumentValue => ({ kind: 'money', amount: round2(amount), currency });
const ratePercent = (rate: number): DocumentValue => ({ kind: 'percent', value: round2(decimalProduct(rate, 100)) });
const text = (value: string | null | undefined): DocumentValue =>
  typeof value === 'string' && value.trim() !== '' ? { kind: 'text', value } : null;

interface StaticField {
  readonly path: string;
  readonly kind: DocumentValueKind;
  readonly group: 'line' | 'pricing';
  readonly internal?: boolean;
  readonly decimals?: number;
}

const LINE_FIELDS: readonly StaticField[] = [
  { path: 'productName', kind: 'text', group: 'line' },
  { path: 'variant', kind: 'text', group: 'line' },
  { path: 'sku', kind: 'text', group: 'line' },
  { path: 'quantity', kind: 'number', group: 'line', decimals: 0 },
  { path: 'packagingUnit', kind: 'text', group: 'line' },
  { path: 'packagingQuantity', kind: 'number', group: 'line' },
  { path: 'listUnitPrice', kind: 'money', group: 'pricing', internal: true, decimals: 2 },
  { path: 'proposedUnitPrice', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'unitPrice', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'unitGrossPrice', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'discountPercent', kind: 'percent', group: 'pricing', internal: true, decimals: 1 },
  { path: 'unitDiscount', kind: 'money', group: 'pricing', internal: true, decimals: 2 },
  { path: 'lineDiscount', kind: 'money', group: 'pricing', internal: true, decimals: 2 },
  { path: 'lineListValue', kind: 'money', group: 'pricing', internal: true, decimals: 2 },
  { path: 'lineNet', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'vatRate', kind: 'percent', group: 'pricing', decimals: 0 },
  { path: 'lineVat', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'lineGross', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'lineNote', kind: 'text', group: 'line' },
];

const SUMMARY_FIELDS: readonly StaticField[] = [
  { path: 'listTotal', kind: 'money', group: 'pricing', internal: true, decimals: 2 },
  { path: 'discountTotal', kind: 'money', group: 'pricing', internal: true, decimals: 2 },
  { path: 'netTotal', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'vatRate', kind: 'percent', group: 'pricing', decimals: 0 },
  { path: 'vatTotal', kind: 'money', group: 'pricing', decimals: 2 },
  { path: 'grossTotal', kind: 'money', group: 'pricing', decimals: 2 },
];

function definitionOf(field: StaticField, label: string): DocumentFieldDefinition {
  return {
    path: field.path,
    label,
    valueKind: field.kind,
    group: field.group,
    audience: field.internal ? 'internal' : 'customer',
    ...(field.decimals !== undefined ? { defaultFormat: { decimals: field.decimals } } : {}),
  };
}

type Line = QuoteRequestDocumentData['lines'][number];

/** The per-unit discount of a line, or `null` when it has none (R-11). */
function unitDiscountOf(line: Line): number | null {
  const list = line.referenceUnitPrice;
  const agreed = line.agreedUnitPrice;
  if (list === null || agreed === null || list <= 0) return null;
  if (line.referenceCurrency !== line.lineCurrency) return null;
  return agreed < list ? Number(moneyDifference(list, agreed)) : null;
}

/** The values of every line, by field path. */
export function quoteLineItems(data: QuoteRequestDocumentData): DocumentItem[] {
  const rate = Number.isFinite(data.quote.taxRate) ? data.quote.taxRate : 0;
  return data.lines.map((line) => {
    const currency = line.lineCurrency;
    const agreed = line.agreedUnitPrice;
    const list = line.referenceUnitPrice;
    const unitDiscount = unitDiscountOf(line);
    const net = agreed !== null ? lineAmountHalfUp(agreed, line.quantity) : null;
    const vat = net !== null ? taxAmountHalfUp(net, rate, 'fraction') : null;
    const values: Record<string, DocumentValue> = {
      productName: text(line.productName),
      variant: text(line.variantLabel),
      sku: text(line.sku),
      quantity: { kind: 'number', value: line.quantity },
      packagingUnit: text(line.packagingUnitName),
      packagingQuantity:
        line.packagingUnitName && line.packagingUnitBaseQuantity && line.packagingUnitBaseQuantity > 0
          ? { kind: 'number', value: line.quantity / line.packagingUnitBaseQuantity }
          : null,
      listUnitPrice: list !== null && line.referenceCurrency ? money(list, line.referenceCurrency) : null,
      proposedUnitPrice: line.proposedUnitPrice !== null ? money(line.proposedUnitPrice, currency) : null,
      unitPrice: agreed !== null ? money(agreed, currency) : null,
      unitGrossPrice: agreed !== null ? money(grossFromNetHalfUp(agreed, rate, 'fraction'), currency) : null,
      discountPercent:
        unitDiscount !== null && list !== null
          ? { kind: 'percent', value: Number(quotientHalfUp(decimalProduct(unitDiscount, 100), list)) }
          : null,
      unitDiscount: unitDiscount !== null ? money(unitDiscount, currency) : null,
      lineDiscount: unitDiscount !== null ? money(lineAmountHalfUp(unitDiscount, line.quantity), currency) : null,
      lineListValue:
        list !== null && line.referenceCurrency ? money(lineAmountHalfUp(list, line.quantity), line.referenceCurrency) : null,
      lineNet: net !== null ? money(net, currency) : null,
      vatRate: ratePercent(rate),
      lineVat: vat !== null ? money(vat, currency) : null,
      lineGross: net !== null && vat !== null ? money(moneySum([net, vat]), currency) : null,
      lineNote: text(line.lineNote),
    };
    for (const [code, value] of Object.entries(line.attributes ?? {})) {
      values[`attributes.${code}`] = text(value);
    }
    return { values };
  });
}

/** The quote's totals — every line or none (R-11). */
export function quoteSummary(data: QuoteRequestDocumentData): Record<string, DocumentValue> {
  const rate = Number.isFinite(data.quote.taxRate) ? data.quote.taxRate : 0;
  const lines = data.lines;
  const vatRate = ratePercent(rate);
  const currencies = new Set(lines.map((line) => line.lineCurrency));
  const none = { listTotal: null, discountTotal: null, netTotal: null, vatRate, vatTotal: null, grossTotal: null };
  if (currencies.size > 1) return none;
  const currency = lines[0]?.lineCurrency ?? data.quote.currency;

  const everyPriced = lines.every((line) => line.agreedUnitPrice !== null);
  const net = everyPriced
    ? moneySum(lines.map((line) => lineAmountHalfUp(line.agreedUnitPrice ?? 0, line.quantity)))
    : null;
  const vat = net !== null ? taxAmountHalfUp(net, rate, 'fraction') : null;

  const everyListed =
    lines.length > 0 &&
    lines.every((line) => line.referenceUnitPrice !== null && line.referenceCurrency === line.lineCurrency);
  const list = everyListed
    ? moneySum(lines.map((line) => lineAmountHalfUp(line.referenceUnitPrice ?? 0, line.quantity)))
    : null;

  const discounts = lines
    .map((line) => {
      const unit = unitDiscountOf(line);
      return unit !== null ? lineAmountHalfUp(unit, line.quantity) : null;
    })
    .filter((value): value is string => value !== null);

  return {
    listTotal: list !== null ? money(list, currency) : null,
    discountTotal: discounts.length > 0 ? money(moneySum(discounts), currency) : null,
    netTotal: net !== null ? money(net, currency) : null,
    vatRate,
    vatTotal: vat !== null ? money(vat, currency) : null,
    grossTotal: net !== null && vat !== null ? money(moneySum([net, vat]), currency) : null,
  };
}

/**
 * Feature 159 — the quote's groups as sections of its lines
 * (`specs/159-quote-request-item-groups/contracts/document-sections.md` §5).
 * `data.lines` is already in display order and `data.groups` holds the groups
 * with a line (the data builder), so each section is a contiguous run of
 * indexes into `quoteLineItems(data)`. Each section's totals follow the
 * document's own rule over the section's lines — an unpriced line leaves its
 * section without net, VAT and gross, and a discount shows only where one
 * applies. A quote with no group is one ungrouped section, which the table
 * prints flat.
 */
export function quoteLineSections(data: QuoteRequestDocumentData): DocumentItemSection[] {
  const indexOf = new Map(data.lines.map((line, index) => [line, index]));
  return arrangeLineGroups(data.groups ?? [], data.lines).map((section) => ({
    key: section.group?.id ?? DOCUMENT_UNGROUPED_SECTION_KEY,
    kind: section.kind,
    label: section.group?.name ?? null,
    itemIndexes: section.lines.map((line) => indexOf.get(line)!),
    summary: quoteSummary({ ...data, lines: [...section.lines] }),
  }));
}

export interface QuoteLinesCollectionDeps {
  /** The attributes shown on the product page — read once per catalogue request. */
  readonly attributes: () => Promise<readonly CatalogAttributeView[]>;
}

/** The `lines` collection the *Quote request* document type declares. */
export function createQuoteLinesCollection(
  deps: QuoteLinesCollectionDeps,
): DocumentCollectionDeclaration<QuoteRequestDocumentData> {
  return {
    key: QUOTE_LINES_COLLECTION,
    labelKey: 'documentTypes.quoteRequest.collections.lines',
    async fields(language) {
      const texts = quoteDocumentTexts(language);
      const out: DocumentFieldDefinition[] = LINE_FIELDS.map((field) =>
        definitionOf(field, texts.fields[field.path] ?? field.path),
      );
      for (const attribute of await deps.attributes()) {
        out.push({
          path: `attributes.${attribute.key}`,
          label: localized(attribute.label, language, attribute.labelDefault || attribute.key),
          valueKind: 'text',
          group: 'product',
          audience: 'customer',
          sampleValue: { kind: 'text', value: texts.attributeSample },
        });
      }
      return out;
    },
    items: quoteLineItems,
    async summaryFields(language) {
      const texts = quoteDocumentTexts(language);
      return SUMMARY_FIELDS.map((field) => definitionOf(field, texts.totals[field.path] ?? field.path));
    },
    summary: quoteSummary,
    sections: quoteLineSections,
  };
}
