import { z } from 'zod';
import { unitPriceFractionDigits } from './money-decimal.js';

/**
 * Typed values of a document's lines, and the pure functions that format them,
 * decide whether one is there, evaluate a visibility rule over them and sum
 * them (`specs/153-quote-request-pdf-template/research.md` R-5, R-6;
 * `contracts/document-collections.md` §3.4).
 *
 * They live here, in the one dependency-free package both the backend renderer
 * and the admin editor canvas import, so the canvas shows exactly what the PDF
 * prints (FR-036) and a later repeater block evaluates the same rules over the
 * same item scope (owner decision D3, FR-044).
 */

// ---------------------------------------------------------------------------
// Field paths
// ---------------------------------------------------------------------------

/**
 * A line field's key: a plain key (`sku`, `lineNet`) or one family segment
 * (`attributes.colour`). Never more than one dot, so a later item-level
 * placeholder `{{item.<path>}}` stays unambiguous.
 */
export const documentFieldPathRe = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]{1,100})?$/;

/**
 * Families a host may not declare: `row` is the facility's (`row.number`, the
 * position it adds to every collection) and `item` is reserved for the
 * repeater's placeholders (research R-23).
 */
export const RESERVED_FIELD_FAMILIES = ['row', 'item'] as const;

/** The facility's own field, prepended to every collection's catalogue. */
export const DOCUMENT_POSITION_FIELD = 'row.number';

export function isReservedFieldPath(path: string): boolean {
  const family = path.split('.')[0] ?? '';
  return (RESERVED_FIELD_FAMILIES as readonly string[]).includes(family);
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export const documentValueKindSchema = z.enum(['text', 'number', 'money', 'percent', 'date']);
export type DocumentValueKind = z.infer<typeof documentValueKindSchema>;

export const documentValueSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), value: z.string() }),
    z.object({ kind: z.literal('number'), value: z.number() }),
    /**
     * `unitPrice` marks a **unit price** (owner ruling of 2026-10-25): it is
     * carried at four places and shown with its significant places, up to
     * four, never fewer than the format's `decimals` (`unitPriceFractionDigits`).
     * A line value or a total is an amount and has no mark.
     *
     * `belowMinorUnit` marks an amount that is **not zero but rounds to zero**
     * at the minor unit — a quote line's discount of 0.0001 a unit over three
     * units (issue #430). It is printed {@link DOCUMENT_BELOW_MINOR_UNIT_TEXT}
     * rather than `0,00`, which would read as "no discount"; the amount stays
     * the rounded `0`, so a sum and "list value − discount = net" still hold.
     */
    z.object({
      kind: z.literal('money'),
      amount: z.number(),
      currency: z.string(),
      unitPrice: z.boolean().optional(),
      belowMinorUnit: z.boolean().optional(),
    }),
    /** `12.5` means 12.5 %. */
    z.object({ kind: z.literal('percent'), value: z.number() }),
    /** An ISO date (`2026-10-17`) or date-time. */
    z.object({ kind: z.literal('date'), value: z.string() }),
  ])
  .nullable();

export type DocumentValue =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'number'; readonly value: number }
  | {
      readonly kind: 'money';
      readonly amount: number;
      readonly currency: string;
      readonly unitPrice?: boolean;
      readonly belowMinorUnit?: boolean;
    }
  | { readonly kind: 'percent'; readonly value: number }
  | { readonly kind: 'date'; readonly value: string }
  | null;

/**
 * What a money value marked `belowMinorUnit` prints, in every language: a dash,
 * not a word, so the document needs no translation for it (issue #430).
 */
export const DOCUMENT_BELOW_MINOR_UNIT_TEXT = '—';

export const documentValueFormatSchema = z.object({
  decimals: z.number().int().min(0).max(4).optional(),
  currencyDisplay: z.enum(['symbol', 'code', 'none']).optional(),
  dateStyle: z.enum(['short', 'medium', 'long']).optional(),
});
export interface DocumentValueFormat {
  readonly decimals?: number;
  readonly currencyDisplay?: 'symbol' | 'code' | 'none';
  readonly dateStyle?: 'short' | 'medium' | 'long';
}

export type DocumentAlign = 'left' | 'center' | 'right';

/** One line of a collection: its values by field path. */
export interface DocumentItem {
  readonly values: Readonly<Record<string, DocumentValue>>;
}

export const documentItemSchema = z.object({ values: z.record(z.string(), documentValueSchema) });

// ---------------------------------------------------------------------------
// Visibility rules
// ---------------------------------------------------------------------------

/**
 * A visibility rule, evaluated over a scope. `field` omitted means "the field
 * of the column, entry or row carrying the rule". Data rather than an enum so
 * later operators (`equals`, `all_of`, …) are additions, not a migration
 * (research R-6).
 */
export type DocumentCondition =
  | { readonly op: 'always' }
  | { readonly op: 'never' }
  | { readonly op: 'has_value'; readonly field?: string }
  | { readonly op: 'any_has_value'; readonly field?: string };

/** What a rule is evaluated over: every item, one item, or the totals. */
export interface DocumentConditionScope {
  readonly items?: readonly DocumentItem[];
  readonly item?: DocumentItem;
  readonly summary?: Readonly<Record<string, DocumentValue>>;
}

// ---------------------------------------------------------------------------
// The pure functions
// ---------------------------------------------------------------------------

/** `null`, a missing value and blank text have none; every number has one, `0` included. */
export function documentValueHasValue(value: DocumentValue | undefined): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  switch (value.kind) {
    case 'text':
    case 'date':
      return typeof value.value === 'string' && value.value.trim() !== '';
    case 'number':
    case 'percent':
      return typeof value.value === 'number' && Number.isFinite(value.value);
    case 'money':
      return typeof value.amount === 'number' && Number.isFinite(value.amount);
    default:
      return false;
  }
}

/**
 * An absolute `http(s)` address — `forms-logic.ts`' pattern, for the same
 * reason: this file runs in the browser and in Node alike and the package's
 * program declares neither runtime's `URL`.
 */
const ABSOLUTE_HTTP_URL = /^https?:\/\/[^\s/?#@]+(?:[/?#][^\s]*)?$/i;

/**
 * Issue #1904 — the address a table cell links to, or `null` for plain text.
 *
 * A column links only when its `link` option is on (`true`, or `'true'` as
 * Puck stores it) **and** its field declares the URL field it may link to
 * (`DocumentFieldDefinition.linkPath`); the item's value there must be text
 * holding an absolute `http(s)` address. Anything else — no option, a field
 * with no URL field, a line with no address, a relative or `javascript:`
 * one — prints the cell as it always did. The PDF renderer and the editor
 * canvas both ask here, so the canvas shows what the PDF links.
 */
export function documentCellLink(
  link: unknown,
  field: { readonly linkPath?: string | undefined } | undefined,
  item: DocumentItem,
): string | null {
  if (link !== true && link !== 'true') return null;
  const path = field?.linkPath;
  if (typeof path !== 'string' || path === '') return null;
  const value = item.values[path];
  if (!value || value.kind !== 'text' || typeof value.value !== 'string') return null;
  const url = value.value.trim();
  return ABSOLUTE_HTTP_URL.test(url) ? url : null;
}

function decimalsFor(value: number, format: DocumentValueFormat, fallback: number): number {
  const wanted = format.decimals;
  if (typeof wanted === 'number' && Number.isInteger(wanted) && wanted >= 0 && wanted <= 4) return wanted;
  return Number.isInteger(value) ? 0 : fallback;
}

function plainNumber(value: number, decimals: number, language: string): string {
  return plainNumberRange(value, decimals, decimals, language);
}

function plainNumberRange(value: number, least: number, most: number, language: string): string {
  return new Intl.NumberFormat(language, {
    minimumFractionDigits: least,
    maximumFractionDigits: most,
  }).format(value);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function rawOf(value: NonNullable<DocumentValue>): string {
  return value.kind === 'money' ? String(value.amount) : String(value.value);
}

/**
 * A value as printed in `language`. No value prints `''`; anything Intl cannot
 * format prints the raw value rather than failing the document.
 */
export function formatDocumentValue(
  value: DocumentValue | undefined,
  format: DocumentValueFormat | undefined,
  language: string,
): string {
  if (!documentValueHasValue(value)) return '';
  const v = value as NonNullable<DocumentValue>;
  const f = format ?? {};
  try {
    switch (v.kind) {
      case 'text':
        return v.value;
      case 'number':
        return plainNumber(v.value, decimalsFor(v.value, f, 2), language);
      case 'percent':
        return `${plainNumber(v.value, decimalsFor(v.value, f, 2), language)} %`;
      case 'money': {
        if (v.belowMinorUnit && v.amount === 0) return DOCUMENT_BELOW_MINOR_UNIT_TEXT;
        const decimals =
          typeof f.decimals === 'number' && Number.isInteger(f.decimals) && f.decimals >= 0 && f.decimals <= 4
            ? f.decimals
            : 2;
        // A unit price never shows fewer places than it carries (up to four).
        const most = v.unitPrice ? Math.max(decimals, unitPriceFractionDigits(v.amount)) : decimals;
        if (f.currencyDisplay === 'none') return plainNumberRange(v.amount, decimals, most, language);
        try {
          return new Intl.NumberFormat(language, {
            style: 'currency',
            currency: v.currency,
            currencyDisplay: f.currencyDisplay === 'code' ? 'code' : 'symbol',
            minimumFractionDigits: decimals,
            maximumFractionDigits: most,
          }).format(v.amount);
        } catch {
          // A currency code Intl does not accept: the number and the code as stored.
          return `${plainNumberRange(v.amount, decimals, most, language)} ${v.currency}`;
        }
      }
      case 'date': {
        const dateOnly = DATE_ONLY_RE.test(v.value);
        const date = new Date(v.value);
        if (Number.isNaN(date.getTime())) return v.value;
        return new Intl.DateTimeFormat(language, {
          dateStyle: f.dateStyle ?? 'medium',
          ...(dateOnly ? { timeZone: 'UTC' } : {}),
        }).format(date);
      }
    }
  } catch {
    return rawOf(v);
  }
  return '';
}

function isCondition(value: unknown): value is DocumentCondition {
  if (value === null || typeof value !== 'object') return false;
  const op = (value as { op?: unknown }).op;
  return op === 'always' || op === 'never' || op === 'has_value' || op === 'any_has_value';
}

/**
 * Whether a rule holds over a scope. An unreadable rule — stored by an older
 * editor, pasted, hand-edited — reads as `always`, the facility's hostile-props
 * rule: a column never vanishes because its rule could not be read.
 */
export function evaluateDocumentCondition(
  condition: unknown,
  scope: DocumentConditionScope,
  defaultField: string,
): boolean {
  if (!isCondition(condition)) return true;
  switch (condition.op) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'has_value': {
      const field = typeof condition.field === 'string' && condition.field !== '' ? condition.field : defaultField;
      const value = scope.item ? scope.item.values[field] : scope.summary?.[field];
      return documentValueHasValue(value);
    }
    case 'any_has_value': {
      const field = typeof condition.field === 'string' && condition.field !== '' ? condition.field : defaultField;
      return (scope.items ?? []).some((candidate) => documentValueHasValue(candidate.values[field]));
    }
  }
}

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * The sum of the values that have one: numbers, or money of one currency
 * rounded to the minor unit. Mixed kinds or currencies — and nothing to sum —
 * answer no value rather than a misleading total.
 */
export function sumDocumentValues(values: readonly (DocumentValue | undefined)[]): DocumentValue {
  const present = values.filter(documentValueHasValue) as NonNullable<DocumentValue>[];
  if (present.length === 0) return null;
  if (present.every((value) => value.kind === 'number')) {
    return { kind: 'number', value: present.reduce((sum, value) => sum + (value as { value: number }).value, 0) };
  }
  if (present.every((value) => value.kind === 'money')) {
    const currency = (present[0] as { currency: string }).currency;
    if (present.some((value) => (value as { currency: string }).currency !== currency)) return null;
    const amount = round2(present.reduce((sum, value) => sum + (value as { amount: number }).amount, 0));
    // Amounts that are real but each round to no cent still sum to something real (issue #430).
    const belowMinorUnit = amount === 0 && present.some((value) => value.kind === 'money' && value.belowMinorUnit === true);
    return belowMinorUnit ? { kind: 'money', amount, currency, belowMinorUnit } : { kind: 'money', amount, currency };
  }
  return null;
}

/** An explicit alignment, else the field's default, else right for numeric kinds and left otherwise. */
export function resolveDocumentAlign(
  align: 'auto' | DocumentAlign | undefined,
  fieldDefault: DocumentAlign | undefined,
  kind: DocumentValueKind | undefined,
): DocumentAlign {
  if (align === 'left' || align === 'center' || align === 'right') return align;
  if (fieldDefault === 'left' || fieldDefault === 'center' || fieldDefault === 'right') return fieldDefault;
  return kind === 'number' || kind === 'money' || kind === 'percent' ? 'right' : 'left';
}
