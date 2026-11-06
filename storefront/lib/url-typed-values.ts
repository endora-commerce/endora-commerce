/**
 * Issue #791 — the one reader (and writer) of the **typed values** a URL may carry beside an
 * error code (`specs/conventions/module-i18n.md`, "A URL-borne error carries a code, never a
 * sentence"). A value is read only when it is in shape, and dropped otherwise: the page then
 * says its sentence without the figure, and never renders `NaN` or hands `Intl` a currency code
 * it throws on. No name and no free text is a typed value.
 *
 * Every page reads its figures here rather than writing its own pattern;
 * `test/url-errors/no-free-text-in-url.test.ts` holds that.
 */

/** A positive whole number of at most nine digits — the cart's `min=` rule from #783. */
const COUNT = /^[1-9]\d{0,8}$/;
/** A non-negative decimal amount, at most twelve integer digits and two places, no exponent. */
const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
/** An ISO 4217 currency code. */
const CURRENCY = /^[A-Z]{3}$/;

type Raw = string | null | undefined;

/** A positive whole number, or `null`. */
export function readCount(raw: Raw): number | null {
  return typeof raw === 'string' && COUNT.test(raw) ? Number(raw) : null;
}

/** A decimal amount, or `null`. */
export function readAmount(raw: Raw): number | null {
  return typeof raw === 'string' && AMOUNT.test(raw) ? Number(raw) : null;
}

/** An ISO 4217 currency code, or `null`. */
export function readCurrency(raw: Raw): string | null {
  return typeof raw === 'string' && CURRENCY.test(raw) ? raw : null;
}

/** An amount and its currency — both, or `null` when either is out of shape. */
export function readMoney(amount: Raw, currency: Raw): { amount: number; currency: string } | null {
  const value = readAmount(amount);
  const code = readCurrency(currency);
  return value === null || code === null ? null : { amount: value, currency: code };
}

/** A whole-number figure as the URL carries it, or `null` when the reader would drop it. */
export function writeCount(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && COUNT.test(String(value)) ? String(value) : null;
}

/**
 * An amount as the URL carries it, from a number or the backend's two-decimal string, or `null`
 * when the reader would drop it.
 */
export function writeAmount(value: unknown): string | null {
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : typeof value === 'string' ? value : '';
  return AMOUNT.test(text) ? text : null;
}

/** A currency code as the URL carries it, or `null` when the reader would drop it. */
export function writeCurrency(value: unknown): string | null {
  return typeof value === 'string' && CURRENCY.test(value) ? value : null;
}
