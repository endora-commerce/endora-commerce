import { foldDiacritics } from '@b2b/contracts';

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
 * **The fold itself is not written here.** Since issue #240 it is
 * `foldDiacritics` from `@b2b/contracts` — the same implementation the backend
 * writes `organizations.name_search` with. This file had grown its own copy of
 * the map for the same reason the four private copies grew: the shared one was
 * correct but named after a single caller (`normalizeOrganizationName`), so
 * nobody looking for a diacritic fold found it. What is left here is the one
 * thing that is genuinely the admin's policy: the trim.
 *
 * What `foldDiacritics` does, in order: decompose (NFD), strip the combining
 * marks, map the letters NFD leaves standing (`Ł ł Ø ø Đ đ Ð ð Þ þ ß Æ æ Œ œ`),
 * lowercase. Step three is the one the obvious
 * `normalize('NFD').replace(/\p{Diacritic}/gu, '')` one-liner is missing, and
 * without it the fold silently does nothing to every Polish word carrying an
 * `ł` (`płatności`, `Nagłówek`).
 *
 * Then, here: **trim.** Surrounding whitespace is noise in every caller — a
 * search query with a leading space matched nothing at all before this step
 * existed (Postel's Law — accept what was typed), and a slug generator strips
 * its own edge separators anyway. Trimming here means no caller has to
 * remember; four of the six had not. The shared fold deliberately leaves
 * whitespace alone, because what counts as one space differs by caller:
 * `normalizeOrganizationName` also collapses internal runs, since it writes a
 * column a `$like` reads.
 *
 * Edge cases worth knowing:
 * - `ß` folds to `ss` and `æ`/`œ` to `ae`/`oe`. The private copy this file
 *   carried until issue #240 left all three standing; adopting the shared map
 *   changed 19 code points in total, 15 of them this way. The other four are
 *   `Ħ ħ Ŧ ŧ` (Maltese, Northern Sami), which the private map folded to `h`/`t`
 *   and the shared one leaves alone. They are **not** silently re-added here:
 *   the shared map is the one the backend writes a persisted search column
 *   with, so growing it re-folds new rows differently from old ones — a data
 *   migration (issue #240's report names it), not a line in this file.
 * - Matching behaves like a case-insensitive substring test, not full Unicode
 *   case folding.
 * - A whitespace-only string folds to the empty string, so callers that treat
 *   an empty query as "match everything" get that for free.
 */
export function normalize(input: string): string {
  return foldDiacritics(input).trim();
}
