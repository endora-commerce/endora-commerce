/**
 * The catalogue's plural forms (issue #85).
 *
 * The catalogue has no plural engine: a counted sentence is keyed once per form
 * — `<key>.one`, `<key>.few`, `<key>.many`, `<key>.other`, the pattern
 * `lineGroups.summary.items.*` set — and the form is chosen here with
 * `Intl.PluralRules`. Polish needs all four (1 pozycja · 2–4 pozycje ·
 * 5–21 pozycji, 12–14 included · 1,5 pozycji); English uses `one` and `other`
 * and writes the same sentence under `few` and `many`.
 *
 * A form a language has beyond these four (`zero`, `two`) falls back to
 * `other`, so a key is never missing.
 */
export type PluralForm = 'one' | 'few' | 'many' | 'other';

export function pluralForm(count: number, locale: string): PluralForm {
  let form: Intl.LDMLPluralRule;
  try {
    form = new Intl.PluralRules(locale).select(count);
  } catch {
    form = new Intl.PluralRules('en-US').select(count);
  }
  return form === 'one' || form === 'few' || form === 'many' ? form : 'other';
}

/** The catalogue key of `base`'s form for `count` — `pluralKey('commerce.cart.subheading', 3, 'pl-PL')`. */
export function pluralKey<B extends string>(base: B, count: number, locale: string): `${B}.${PluralForm}` {
  return `${base}.${pluralForm(count, locale)}`;
}
