type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * A counted sentence in the reader's language: `key.<form>` for the form
 * `Intl.PluralRules` selects (`one`, `few`, `many`, `other`…), the bundles'
 * plural suffixes (`lineGroups.summary.items.few`). A form the bundle does not
 * carry falls back to `key.other`, so English ships `one` and `other` only while
 * Polish ships `one`, `few`, `many` and `other` — "1 dzień", "2 dni", "5 dni".
 *
 * The kit's `t()` answers a missing key with its own `scope.key` placeholder,
 * which is how the fallback is detected.
 */
export function translatePlural(
  t: Translate,
  language: string,
  key: string,
  count: number,
  params: Record<string, string | number> = {},
): string {
  const values = { count, ...params };
  const form = `${key}.${new Intl.PluralRules(language).select(count)}`;
  const value = t(form, values);
  return value.endsWith(form) ? t(`${key}.other`, values) : value;
}
