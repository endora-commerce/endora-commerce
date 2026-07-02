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
