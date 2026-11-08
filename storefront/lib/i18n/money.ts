/**
 * Locale-aware money formatting for the storefront.
 *
 * Amounts must be formatted according to the currency of the country the
 * active Sales Channel targets — e.g. Poland + PLN renders as `1234,56 zł`
 * (comma decimal separator, `zł` suffix) using the `pl-PL` locale. The
 * channel's resolved display locale is the primary signal; when a call-site
 * has no locale to hand, `localeForCurrency` picks the currency's home
 * locale so the number/symbol conventions still match the money's currency.
 */

import { grossAmountHalfUp, grossFromNetHalfUp, grossUnitPriceHalfUp, unitPriceFractionDigits } from '@endora-commerce/contracts';

/**
 * Representative BCP-47 locale per ISO-4217 currency. Keeps amounts in the
 * conventions of the currency's home country (decimal separator, grouping,
 * symbol placement) even without an explicit channel locale.
 */
const LOCALE_BY_CURRENCY: Record<string, string> = {
  PLN: 'pl-PL',
  EUR: 'de-DE',
  USD: 'en-US',
  GBP: 'en-GB',
  CHF: 'de-CH',
  CZK: 'cs-CZ',
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  DKK: 'da-DK',
  HUF: 'hu-HU',
  RON: 'ro-RO',
  UAH: 'uk-UA',
};

export function localeForCurrency(currency: string): string {
  return LOCALE_BY_CURRENCY[currency.toUpperCase()] ?? 'en-US';
}

/** What a formatted amount is. */
export interface FormatMoneyOptions {
  /**
   * The amount is a **unit price** — a product's price, a cart, order or quote
   * line's unit price (owner ruling of 2026-10-25): two places when its third
   * and fourth are zero, otherwise its significant places, up to four
   * (`0,0125 zł`, `1,50 zł`, `1,505 zł`) — `unitPriceFractionDigits` from
   * `@endora-commerce/contracts`, the one rule the admin, the documents and the
   * e-mails share. A line value or a total is not one and shows two.
   */
  unitPrice?: boolean;
}

/**
 * Format a decimal money amount as a localized currency string.
 *
 * @param amount   decimal amount (not minor units), e.g. `1234.56`
 * @param currency ISO-4217 code, e.g. `PLN`
 * @param locale   optional BCP-47 locale; defaults to the currency's home
 *                 locale so PLN renders as `1234,56 zł` regardless.
 * @param options  `{ unitPrice: true }` for a unit price (see {@link FormatMoneyOptions}).
 */
export function formatMoney(
  amount: number,
  currency: string,
  locale?: string,
  options: FormatMoneyOptions = {},
): string {
  const loc = locale && locale.trim() !== '' ? locale : localeForCurrency(currency);
  const digits = options.unitPrice && Number.isFinite(amount) ? unitPriceFractionDigits(amount) : 2;
  try {
    return new Intl.NumberFormat(loc, {
      style: 'currency',
      currency,
      ...(options.unitPrice ? { minimumFractionDigits: 2, maximumFractionDigits: digits } : {}),
    }).format(amount);
  } catch {
    // Unknown/invalid currency code — fall back to a plain number + code.
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** Convenience overload for the `{ amount, currency }` money shape. */
export function formatMoneyObject(
  money: { amount: number; currency: string },
  locale?: string,
  options: FormatMoneyOptions = {},
): string {
  return formatMoney(money.amount, money.currency, locale, options);
}

/*
 * There is no VAT rate here, and that is deliberate — issue #852.
 *
 * `DEFAULT_VAT_RATE` (0.23) stood here as the storefront's one assumption about
 * VAT (issue #132), because nothing it read for a product carried a rate. The
 * cart stopped assuming it first (issue #436): `GET /api/v1/cart` answers each
 * line's rate and the cart's VAT per rate. The catalogue followed (issue
 * #852): every product of the listing and the product page carries `vatRate`,
 * the buyer's rate for that product, resolved by the same rule the cart and the
 * order use. So every gross the storefront derives is derived at a rate the
 * backend resolved, and where a read carries none the surface shows the net,
 * labelled net — a gross at an assumed rate is not a figure.
 */

/**
 * Derive a gross amount from a net one, or `null` when there is no rate to
 * apply — a gross figure nobody supplied a rate for is not a figure.
 *
 * A net of `0` derives a gross of `0`. That is not a detail: one of the three
 * copies this replaces tested the derived amount for truthiness, so a free
 * product silently lost its gross line while every other product kept one.
 *
 * The gross is the exact decimal product rounded half-up to two places —
 * `grossAmountHalfUp`, the rule a gross product feed publishes with (review 2,
 * finding 2 of release 0.108.0; `specs/pricing/worked-examples.md` §10.16).
 * `net * (1 + vatRate)` on doubles made 16.50 at 23 % the double 20.29499…,
 * shown as 20,29 where the feed says 20,30.
 */
export function grossFromNet(net: number, vatRate: number | null): number | null {
  if (vatRate === null || !Number.isFinite(net) || !Number.isFinite(vatRate)) return null;
  if (vatRate < 0) return net * (1 + vatRate);
  // A negative net (a credit) rounds half away from zero on the exact product.
  if (net < 0) return Number(grossFromNetHalfUp(net, vatRate, 'fraction'));
  return Number(grossAmountHalfUp(net, vatRate, 'fraction'));
}

/**
 * The gross of a **unit price** (owner ruling of 2026-10-25): two places for a
 * net that shows two (`29.50` → `36.29`, the same as {@link grossFromNet}), four
 * for a sub-cent net (`0.0125` → `0.0154`) — a gross unit price rounded to the
 * cent would misstate a sub-cent price by up to a third. `grossUnitPriceHalfUp`.
 */
export function grossUnitPriceFromNet(net: number, vatRate: number | null): number | null {
  if (vatRate === null || !Number.isFinite(net) || !Number.isFinite(vatRate) || net < 0 || vatRate < 0) {
    return grossFromNet(net, vatRate);
  }
  return Number(grossUnitPriceHalfUp(net, vatRate, 'fraction'));
}

/**
 * Resolve a net `Money` value into the amount(s) a given display mode should
 * render. Centralises the net/gross/both decision so the cart, product cards,
 * and PDP all agree on one settings-driven presentation:
 *   - `net_only`  → net amount, tagged net.
 *   - `gross_only`→ gross amount (net × 1+vat), tagged gross.
 *   - `both`      → net primary + gross secondary.
 *   - `none`      → net amount, untagged (no price emphasis; callers that hide
 *                   prices entirely handle `none` before calling this).
 */
export type PriceTaxKind = 'net' | 'gross' | null;

export interface MoneyByMode {
  primary: string;
  primaryKind: PriceTaxKind;
  secondary: string | null;
  secondaryKind: PriceTaxKind;
}

export function moneyByMode(
  net: { amount: number; currency: string },
  mode: 'net_only' | 'gross_only' | 'both' | 'none',
  locale: string | undefined,
  /** The resolved rate (issue #852); `null` derives no gross, and every mode shows the net. */
  vatRate: number | null,
  options: FormatMoneyOptions = {},
): MoneyByMode {
  const gross = options.unitPrice ? grossUnitPriceFromNet(net.amount, vatRate) : grossFromNet(net.amount, vatRate);
  return moneyByModeWithGross(net, gross, mode, locale, options);
}

/**
 * {@link moneyByMode} with the gross **given** rather than derived — issue
 * #436: the cart's totals and line grosses are the backend's, computed per
 * rate the way the order computes them, and a client deriving them again from
 * one rate would show a figure the order does not charge. `gross` is `null`
 * when nobody supplied one: then every mode shows the net, tagged net (`none`
 * untagged), because a gross nobody computed is not a figure.
 */
export function moneyByModeWithGross(
  net: { amount: number; currency: string },
  gross: number | null,
  mode: 'net_only' | 'gross_only' | 'both' | 'none',
  locale?: string,
  options: FormatMoneyOptions = {},
): MoneyByMode {
  const netStr = formatMoneyObject(net, locale, options);
  if (mode === 'none') return { primary: netStr, primaryKind: null, secondary: null, secondaryKind: null };
  if (gross === null || mode === 'net_only') {
    return { primary: netStr, primaryKind: 'net', secondary: null, secondaryKind: null };
  }
  const grossStr = formatMoney(gross, net.currency, locale, options);
  return mode === 'gross_only'
    ? { primary: grossStr, primaryKind: 'gross', secondary: null, secondaryKind: null }
    : { primary: netStr, primaryKind: 'net', secondary: grossStr, secondaryKind: 'gross' };
}
