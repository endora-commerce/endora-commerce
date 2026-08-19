/**
 * Fold a string so two spellings of the same word compare equal.
 *
 * **This is a general text utility, not palette machinery.** It lived under
 * `lib/admin-actions/` until issue #236, which under-sold it as one consumer's
 * private helper and invited the next author to write their own: by then the
 * page-builder drawer, the combobox and the multi-select had each grown a copy
 * that looked right and was not. The admin has two kinds of caller, and both
 * need the same fold:
 *
 *  - **search predicates** — the ⌘K palette, the page-builder drawer, the
 *    combobox / multi-select pickers, the category tree filter. Fold both the
 *    query and the haystack, then `includes`.
 *  - **slug and code generators** — `PageEditor`, `BlockEditor`,
 *    `BlogPostEditor`. Fold first, then collapse whatever is left to `-` / `_`.
 *
 * What it does, in order:
 *
 * 1. Hand-fold a small set of stroked letters — `Ł ł Ø ø Đ đ Ħ ħ Ŧ ŧ`. This
 *    step comes **first and cannot be dropped**: those are standalone
 *    codepoints with no canonical decomposition, so NFD leaves them exactly
 *    where they were. That is the whole reason the obvious
 *    `normalize('NFD').replace(/\p{Diacritic}/gu, '')` one-liner is wrong —
 *    it reads as complete and silently fails every Polish word with an `ł`
 *    in it (`płatności`, `Nagłówek`). It is the minimum needed for our Polish
 *    UI and avoids pulling in a full Unicode-folding library.
 * 2. Decompose (NFD) to separate base characters from their combining marks.
 * 3. Strip the combining marks via `\p{Diacritic}`.
 * 4. Lowercase.
 * 5. Trim. Surrounding whitespace is noise in every caller: a search query
 *    with a leading space matched nothing at all before this step existed
 *    (Postel's Law — accept what was typed), and a slug generator strips its
 *    own edge separators anyway. Trimming here means no caller has to
 *    remember; four of the six had not.
 *
 * Edge cases worth knowing:
 * - `ß` has no decomposition and is not in the stroked-letter map, so it stays
 *   as `ß` (not folded to `ss`). Matching behaves like a case-insensitive
 *   substring test, not full Unicode case-folding.
 * - A whitespace-only string folds to the empty string, so callers that treat
 *   an empty query as "match everything" get that for free.
 */
const STROKED_LETTER_MAP: Record<string, string> = {
  Ł: 'L',
  ł: 'l',
  Ø: 'O',
  ø: 'o',
  Đ: 'D',
  đ: 'd',
  Ħ: 'H',
  ħ: 'h',
  Ŧ: 'T',
  ŧ: 't',
};

export function normalize(input: string): string {
  let folded = input;
  for (const [src, tgt] of Object.entries(STROKED_LETTER_MAP)) {
    if (folded.includes(src)) folded = folded.split(src).join(tgt);
  }
  return folded.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}
