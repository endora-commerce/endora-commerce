/**
 * One diacritic fold, for every package that has to compare two spellings of
 * the same word (issue #240).
 *
 * ## Why this file exists rather than a helper inside one consumer
 *
 * The fold was correct and unreachable. It lived inside
 * `normalizeOrganizationName` in `organizations.ts` — published from
 * `@b2b/contracts`, so importable from `backend/`, `admin/` and `storefront/`
 * alike, but named after **one caller**. Nobody looking for "how do I compare
 * `Łatwy` with `latwy`" searches for an organisation helper, so within a year
 * four private copies had grown in `admin/` (repaired by !745) and two more
 * stand in `backend/` today. Every one of them was the same one-liner and every
 * one of them shipped the same bug.
 *
 * ## The bug the one-liner has
 *
 * ```
 * input.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
 * ```
 *
 * reads as complete and is not. `ł` is U+0142: a single indivisible code point
 * with **no canonical decomposition**, so NFD leaves it exactly where it was,
 * the strip finds no combining mark to remove, and the `[^a-z0-9]+` pass a
 * slugifier runs next deletes the letter outright — `Łatwy szablon` becomes
 * `atwy-szablon`. The same holds for `Ø ø Đ đ Ð ð Þ þ ß Æ æ Œ œ`. The fix is one
 * extra step, and it is the only reason this is longer than a line: map those
 * letters explicitly.
 *
 * ## A function, not a port
 *
 * It is pure over its argument, so it cannot answer differently depending on
 * which modules are switched on, and a gated port answering 503 `MODULE_DISABLED`
 * to "fold these diacritics" would be a bug rather than a safety property.
 * Node natives only (Principle IV) — a full Unicode-folding library is not worth
 * a dependency for fifteen letters.
 */

/**
 * Latin letters NFD does not decompose, and their ASCII approximations.
 *
 * Every entry is a **single code point** whose Unicode decomposition is empty:
 * a stroked, hooked or ligated letter rather than a base plus a combining mark.
 * That is precisely the set NFD cannot help with, which is why it is hand-written.
 *
 * Exported so a test can enumerate it and a reader can see the whole set at
 * once — not as an invitation to write a second fold around it. Reach for
 * `foldDiacritics` instead; a copy of the map without the decomposition step
 * is half a fold, and half a fold is what this file exists to end.
 */
export const NON_DECOMPOSING_LATIN: Readonly<Record<string, string>> = {
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

/**
 * Fold a string so two spellings of the same word compare equal: diacritics
 * removed, non-decomposing Latin letters mapped to ASCII, lowercased.
 *
 * In order:
 *
 * 1. **Decompose (NFD)** — separate every base character from its combining
 *    marks, so `ó` becomes `o` + U+0301.
 * 2. **Strip the combining marks** via `\p{Diacritic}`.
 * 3. **Map what NFD could not decompose**, per `NON_DECOMPOSING_LATIN`. This
 *    step runs **after** the decomposition on purpose: `Ǿ` (U+01FE) decomposes
 *    to `Ø` + U+0301, so a map applied first would not see the `Ø` that step 1
 *    is about to expose. Mapping first — as `admin/`'s copy did until issue
 *    #240 — folds `Ǿ` to `ø` instead of `o`.
 * 4. **Lowercase.** Callers compare case-insensitively without exception, and
 *    the ASCII expansions above (`Th`, `AE`, `OE`) have to be lowered anyway.
 *
 * Whitespace is deliberately **not** touched: what counts as one space is the
 * caller's policy, not the fold's. `normalizeOrganizationName` collapses runs
 * and trims because it writes a search column; `admin`'s `normalize` only
 * trims. Both compose it here rather than each folding its own way.
 *
 * Not a case-folding routine in the Unicode sense: it lowercases, it does not
 * apply full case folding, and anything outside Latin (Cyrillic, CJK, Greek)
 * passes through with its case lowered and nothing else changed.
 */
export function foldDiacritics(input: string): string {
  const stripped = input.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  let mapped = '';
  for (const character of stripped) {
    mapped += NON_DECOMPOSING_LATIN[character] ?? character;
  }
  return mapped.toLowerCase();
}
