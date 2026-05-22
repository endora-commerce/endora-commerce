/**
 * Diacritic-insensitive normalization for the Organization's `name_search`
 * column.
 *
 * Strips every Unicode combining mark using NFD decomposition, then maps
 * the handful of precomposed Latin letters that NFD does NOT decompose
 * (notably Polish `ł`/`Ł`, Scandinavian `ø`/`Ø`, Czech `đ`/`Đ`, Icelandic
 * `ð`/`Ð`, `þ`/`Þ`, German `ß`, ligatures `æ` and `œ`) to their ASCII
 * approximations. Lowercases the result and collapses internal whitespace.
 *
 * Used by the entity `@BeforeCreate` / `@BeforeUpdate` hooks AND by the
 * picker endpoint when normalizing the user's query string — guarantees
 * that a search for "lodz" hits "Łódź" and vice-versa.
 *
 * Implementation uses Node natives only (Principle IV — no new dep).
 */
const NON_DECOMPOSING_LATIN: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Ø: 'O',
  ø: 'o',
  Đ: 'D',
  đ: 'd',
  Ð: 'D',
  ð: 'd',
  Þ: 'Th',
  þ: 'th',
  ß: 'ss',
  Æ: 'AE',
  æ: 'ae',
  Œ: 'OE',
  œ: 'oe',
};

export function normalizeOrganizationName(input: string): string {
  const stripped = input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  let mapped = '';
  for (const ch of stripped) {
    mapped += NON_DECOMPOSING_LATIN[ch] ?? ch;
  }
  return mapped.toLowerCase().replace(/\s+/g, ' ').trim();
}
