import { tForLocale } from './i18n/messages';
import { format } from './i18n/format';
import { formatMoney } from './i18n/money';
import { formatCount } from './orderMinimum';
import type { UrlErrorVocabulary } from './url-errors';
import { readAmount, readCount, readCurrency, writeAmount, writeCount, writeCurrency } from './url-typed-values';

/**
 * Issue #791 — the figures the backend's sentences carried, brought back beside a URL-borne
 * error code as typed values (`specs/conventions/module-i18n.md`). Two refusals carry them:
 *
 * - `LIMIT_INSUFFICIENT` — `available`, `total` and `currency`: the credit limit still
 *   available and the refused order's total, both the placing organization's own figures
 *   (`order-service.ts` puts them in the refusal's `details`);
 * - `PRODUCT_BELOW_MINIMUM_QUANTITY` / `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` — `min`, the
 *   minimum. Never the product's or the packaging unit's name: a name is free text;
 * - `ORDER_BELOW_MINIMUM_VALUE` — `minValue`, `subtotal` and `currency` (#832): the store's
 *   minimum order value and the basket's subtotal, as the backend rounds them.
 *
 * Every amount is a display figure rounded to two places: the page formats it and never does
 * arithmetic with it.
 *
 * The cart line's own refused edit keeps its line-scoped reading (`lib/cartMinimum.ts`), which
 * also names the line's packaging unit; this is the reading of every other place a minimum or a
 * credit-limit refusal lands — the cart's banner, the checkout failure page, quick order.
 */

/** The figures a page may read beside its error code — each still unvalidated, as the URL has it. */
export interface UrlErrorFigures {
  min?: string | undefined;
  minValue?: string | undefined;
  subtotal?: string | undefined;
  available?: string | undefined;
  total?: string | undefined;
  currency?: string | undefined;
}

const MINIMUM_CODES = new Set(['PRODUCT_BELOW_MINIMUM_QUANTITY', 'PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY']);

/** The refusal's code and `details`, read by shape (this module is reached from client code). */
function refusal(err: unknown): { code: string; details: Record<string, unknown> } | null {
  if (!(err instanceof Error)) return null;
  const { code, details } = err as { code?: unknown; details?: unknown };
  if (typeof code !== 'string' || details === null || typeof details !== 'object') return null;
  return { code, details: details as Record<string, unknown> };
}

/** A negative amount — a number or the backend's decimal string — as 0; anything else unchanged. */
function clampedAtZero(value: unknown): unknown {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && /^-\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
  return amount !== null && Number.isFinite(amount) && amount < 0 ? 0 : value;
}

/**
 * The figures `err` carries, as a query-string tail (`&min=10`) to append after its code, or `''`.
 * Only a figure the page's reader accepts is written; a credit-limit refusal carries all three
 * or none, since one amount without the other names nothing.
 */
export function errorFiguresQuery(err: unknown): string {
  const found = refusal(err);
  if (found === null) return '';
  const qs = new URLSearchParams();
  if (MINIMUM_CODES.has(found.code)) {
    const minimum = writeCount(found.details['minimum']);
    if (minimum !== null) qs.set('min', minimum);
  } else if (found.code === 'LIMIT_INSUFFICIENT') {
    // Architect ruling on #831 (Q2): a limit lowered below what is already used leaves a negative
    // available amount; the buyer reads it as none left, so it is written as 0. The reader stays
    // strict and never accepts a negative amount from the URL.
    const available = writeAmount(clampedAtZero(found.details['availableAmount']));
    const total = writeAmount(found.details['orderTotal']);
    const currency = writeCurrency(found.details['currency']);
    if (available !== null && total !== null && currency !== null) {
      qs.set('available', available);
      qs.set('total', total);
      qs.set('currency', currency);
    }
  } else if (found.code === 'ORDER_BELOW_MINIMUM_VALUE') {
    const minimum = writeAmount(found.details['minimum']);
    const subtotal = writeAmount(found.details['subtotal']);
    const currency = writeCurrency(found.details['currency']);
    if (minimum !== null && subtotal !== null && currency !== null) {
      qs.set('minValue', minimum);
      qs.set('subtotal', subtotal);
      qs.set('currency', currency);
    }
  }
  const tail = qs.toString();
  return tail === '' ? '' : `&${tail}`;
}

/**
 * The sentence for `code` with the figures beside it, or `null` when there is no code. A figure
 * out of shape is dropped and the code reads as its bare sentence; a code that carries no
 * figures reads through `vocabulary` as always, whatever figures the URL holds.
 */
export function urlErrorText(
  vocabulary: Pick<UrlErrorVocabulary<string, string>, 'errorKey'>,
  code: string | undefined,
  figures: UrlErrorFigures,
  locale: string,
): string | null {
  const key = vocabulary.errorKey(code);
  if (key === null) return null;
  const t = tForLocale(locale);
  // Only the code's own key is worded with figures: an unknown code reads as the generic failure.
  if (key === 'commerce.error.LIMIT_INSUFFICIENT') {
    const available = readAmount(figures.available);
    const total = readAmount(figures.total);
    const currency = readCurrency(figures.currency);
    if (available !== null && total !== null && currency !== null) {
      return format(t('commerce.errorFigures.LIMIT_INSUFFICIENT'), {
        available: formatMoney(available, currency, locale),
        total: formatMoney(total, currency, locale),
      });
    }
  } else if (key === 'commerce.error.ORDER_BELOW_MINIMUM_VALUE') {
    const minimum = readAmount(figures.minValue);
    const subtotal = readAmount(figures.subtotal);
    const currency = readCurrency(figures.currency);
    if (minimum !== null && subtotal !== null && currency !== null) {
      return format(t('commerce.errorFigures.ORDER_BELOW_MINIMUM_VALUE'), {
        minimum: formatMoney(minimum, currency, locale),
        subtotal: formatMoney(subtotal, currency, locale),
      });
    }
  } else if (key === 'commerce.error.PRODUCT_BELOW_MINIMUM_QUANTITY' || key === 'commerce.error.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY') {
    const minimum = readCount(figures.min);
    if (minimum !== null) {
      return format(
        t(
          key === 'commerce.error.PRODUCT_BELOW_MINIMUM_QUANTITY'
            ? 'commerce.errorFigures.PRODUCT_BELOW_MINIMUM_QUANTITY'
            : 'commerce.errorFigures.PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY',
        ),
        { count: formatCount(minimum, locale) },
      );
    }
  }
  return t(key);
}
