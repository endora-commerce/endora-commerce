/**
 * Fill a catalogue sentence's `{name}` placeholders (issue #85).
 *
 * ```ts
 * format(t('account.orders.count'), { count: formatCount(n, locale) })
 * ```
 *
 * **One pass, through a function**, so a value is inserted verbatim: a product
 * name carrying `{line}` is not read as a second placeholder, and one carrying
 * `$&` is not read as a replacement pattern — both of which a chain of
 * `.replace('{x}', value)` calls gets wrong. A placeholder with no value is left
 * as written, so a missing argument shows up in the rendered text rather than
 * as an empty gap.
 *
 * Values are strings on purpose: a number is formatted for the reader's locale
 * by the caller (`formatCount`, the money helpers), which this function cannot
 * do for it.
 *
 * Extracted from `lib/quote-requests/describe-diff.ts`, which filled its
 * comparison sentences this way first.
 */
export function format(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : match,
  );
}
