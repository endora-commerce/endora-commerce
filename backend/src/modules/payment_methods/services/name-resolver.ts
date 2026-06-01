/**
 * Resolve a payment-method display name (feature 034, FR-008).
 *
 * A method's `name` is a `lang → label` record. Resolution order:
 *   1. exact language match (`name[lang]`),
 *   2. the `default` key,
 *   3. the first available value.
 *
 * Returns an empty string only for an empty record (which the schema rejects).
 */
export function resolvePaymentMethodName(
  name: Record<string, string>,
  lang?: string | null,
): string {
  if (lang && name[lang]) return name[lang];
  if (name.default) return name.default;
  const first = Object.values(name)[0];
  return first ?? '';
}
