/**
 * The label of a delivery or payment method in the page language (issue #1324).
 *
 * A method's `name` is a `lang → label` record (`packages/contracts`'
 * `paymentMethodNameSchema`). The listing endpoints return the whole record, so
 * the language is picked here, from the locale the page renders in. Order:
 *   1. the page language (`name[locale]`),
 *   2. the `default` key, the contract's language-neutral entry,
 *   3. `en-US`,
 *   4. the first value.
 *
 * Checkout and `/preferences` both use this, so a buyer sees one name for one
 * method across the two pages.
 */
export function methodName(name: Readonly<Record<string, string>>, locale: string): string {
  return name[locale] || name.default || name['en-US'] || Object.values(name)[0] || '';
}
