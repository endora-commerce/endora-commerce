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

/**
 * Format a decimal money amount as a localized currency string.
 *
 * @param amount   decimal amount (not minor units), e.g. `1234.56`
 * @param currency ISO-4217 code, e.g. `PLN`
 * @param locale   optional BCP-47 locale; defaults to the currency's home
 *                 locale so PLN renders as `1234,56 zł` regardless.
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  const loc = locale && locale.trim() !== '' ? locale : localeForCurrency(currency);
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency }).format(amount);
  } catch {
    // Unknown/invalid currency code — fall back to a plain number + code.
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Convenience overload for the `{ amount, currency }` money shape. */
export function formatMoneyObject(
  money: { amount: number; currency: string },
  locale?: string,
): string {
  return formatMoney(money.amount, money.currency, locale);
}

/**
 * The VAT rate this deployment **assumes** when deriving a gross amount from a
 * net one — issue #132.
 *
 * It is an assumption, and saying so is the point. The `taxes` module resolves
 * a real rate per `(country, productType, vatStatus)`, but nothing the
 * storefront reads carries it: `ProductSummary`, `CartSummary` and the
 * resolved-price payload are all net-only, and the `taxes` routes are
 * admin-gated. So no code path on a listing, a card, a PDP price block or a
 * cart line can consult a tax authority today.
 *
 * What changed here is that the assumption lives in one place instead of three.
 * `BaseSalePriceBlock`, `ProductCard` and `ProductRow` each carried their own
 * `0.23` / `1.23` literal, so a deployment in another jurisdiction had nothing
 * to correct; each of them now takes an optional rate and defaults to this
 * constant. When the resolved rate reaches the wire, this is the one seam that
 * has to change.
 */
export const DEFAULT_VAT_RATE = 0.23;

/**
 * Derive a gross amount from a net one, or `null` when there is no rate to
 * apply — a gross figure nobody supplied a rate for is not a figure.
 *
 * A net of `0` derives a gross of `0`. That is not a detail: one of the three
 * copies this replaces tested the derived amount for truthiness, so a free
 * product silently lost its gross line while every other product kept one.
 */
export function grossFromNet(net: number, vatRate: number | null): number | null {
  if (vatRate === null || !Number.isFinite(net) || !Number.isFinite(vatRate)) return null;
  return net * (1 + vatRate);
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
  locale?: string,
  vatRate: number = DEFAULT_VAT_RATE,
): MoneyByMode {
  const netStr = formatMoneyObject(net, locale);
  const gross = grossFromNet(net.amount, vatRate);
  const grossStr = formatMoney(gross ?? net.amount, net.currency, locale);
  switch (mode) {
    case 'gross_only':
      return { primary: grossStr, primaryKind: 'gross', secondary: null, secondaryKind: null };
    case 'both':
      return { primary: netStr, primaryKind: 'net', secondary: grossStr, secondaryKind: 'gross' };
    case 'net_only':
      return { primary: netStr, primaryKind: 'net', secondary: null, secondaryKind: null };
    case 'none':
      return { primary: netStr, primaryKind: null, secondary: null, secondaryKind: null };
  }
}
