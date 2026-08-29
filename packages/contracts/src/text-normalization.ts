/**
 * One diacritic fold — and, since issue #245, one slug generator — for every
 * package that has to compare or key two spellings of the same word.
 *
 * `foldDiacritics` is the fold (issue #240). `slugify` is the generator built
 * on it, and it replaced **eight** private copies; its own doc block carries
 * the reasons that are specific to slugs. Everything below is about the fold.
 *
 * ## Why this file exists rather than a helper inside one consumer
 *
 * The fold was correct and unreachable. It lived inside
 * `normalizeOrganizationName` in `organizations.ts` — published from
 * `@endora-commerce/contracts`, so importable from `backend/`, `admin/` and `storefront/`
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

/**
 * How one caller's slug grammar differs from another's. Every field is the
 * caller's own policy; the *steps* are not negotiable and are not options.
 */
export interface SlugifyOptions {
  /**
   * What a run of unusable characters collapses to. `-` everywhere except the
   * newsletter tag code, whose stored grammar is `_`.
   */
  readonly separator?: string;
  /**
   * The caller's own column or contract limit. **Deliberately not defaulted to
   * a repo-wide number**: eight call sites cap at 80, 150, 160, 180 or not at
   * all, and each cap decides which *new* values collide under that caller's
   * unique constraint. Normalising them would be a data decision dressed as a
   * tidy-up.
   */
  readonly maxLength?: number;
  /** What an input that folds away to nothing produces. Empty string by default. */
  readonly fallback?: string;
  /**
   * Characters the caller's grammar allows **besides** `[a-z0-9]`, which
   * therefore survive instead of collapsing to the separator.
   *
   * Empty for every slug in the kebab family, and that is the reason this is an
   * option rather than a widening of the rule: `pim_ergonode`'s option values
   * are stored under `^[a-z0-9_-]{1,200}$`, a grammar with **two** usable
   * punctuation characters, so a generator that knows only one separator cannot
   * express it. Without this, folding those values correctly would also have
   * turned every already-correct `xl-red` into `xl_red` — a rename with no
   * defect behind it, and one that orphans the option every product already
   * points at (issue #260).
   *
   * Members are matched literally inside a negated character class, so a
   * caller passes the characters themselves (`'-'`), not an escaped class.
   */
  readonly preserve?: string;
}

/** Escape a separator so it can sit inside a character class. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * The repository's one slug generator (issue #245).
 *
 * There were **eight**: three in `backend/`, five in `admin/`, each a private
 * four-line chain that read as obviously right. Two of them
 * (`cms-template-layout.ts`, `pim_ergonode`'s `slugFromSourceCode`) had no fold
 * step at all — `Żółw` produced `w` and `Świeże Ćwikła` produced `wie-e-wik-a`
 * — and `check:diacritic-folds` was structurally blind to both, because it
 * counts folds written *outside* the shared helper and a site that folds
 * nothing writes none. A shared generator is what makes "does this slug fold?"
 * a question with one answer.
 *
 * The steps, in order:
 *
 * 1. **Fold** via `foldDiacritics` — decompose, strip the combining marks, map
 *    the letters NFD leaves standing, lowercase.
 * 2. **Collapse** every run of `[^a-z0-9]` — minus whatever `preserve` adds to
 *    the usable set — to the separator.
 * 3. **Strip a leading separator**, before the slice — a leading separator can
 *    never survive, so it must not spend a character of the caller's budget.
 * 4. **Slice** to `maxLength`, when the caller has one.
 * 5. **Strip trailing separators**, after the slice — the cut can *create* one,
 *    which is the whole point (see below).
 * 6. **Fall back** when nothing survived.
 *
 * ## NFD, not NFKD, and that is a decision
 *
 * Three of the eight normalised with `NFKD`, which additionally maps the
 * compatibility characters: `ﬁ` to `fi`, `²` to `2`, the full-width forms to
 * their ASCII. Those mappings reach a slug **only** through characters that map
 * *into* `[a-z0-9]`, and none of them is typed into a product name, a feed
 * template name or a CMS page title. Where one does appear it now collapses to
 * the separator rather than to a letter, so the slug stays legal and merely
 * loses a character nobody could see in it. Against that, `ł` was being deleted
 * out of every Polish name those three touched. The trade was taken for the
 * admin pair in !753 and holds identically here.
 *
 * It has one consequence worth naming: two inputs `NFKD` kept apart can now
 * fold together (`Kabel²` and `Kabel³` both become `kabel`). Every caller whose
 * slug is unique-constrained already allocates against the live table —
 * `CatalogAdminService.allocateUniqueSlug`, `pim_ergonode`'s
 * `createWithFreeSlug` — so the second one is suffixed rather than rejected,
 * exactly as two products sharing a plain name already are.
 *
 * ## The trailing strip runs after the slice, which is a change for six sites
 *
 * Six of the eight stripped **both** edge separators before cutting to length,
 * so a cut landing on a separator left the slug ending in one:
 * `...w-wersji-rozszerzona-`. Only `BlockEditor` and `PageEditor` had it right.
 * This is the one change here that is not about diacritics; it shows only on an
 * input long enough to be truncated, and it makes the result satisfy the kebab
 * grammar (`^[a-z0-9]+(?:-[a-z0-9]+)*$`) that `pim_ergonode`'s own doc block
 * already claimed for it.
 *
 * The **leading** strip stays where all eight had it — before the slice — for a
 * reason that is not symmetry: a leading separator is never part of the answer,
 * so letting it consume a character of `maxLength` would shorten every slug
 * whose input begins with punctuation by one, in six sites at once, for no
 * gain. Only the trailing edge can be *created* by the cut, so only the
 * trailing strip has to run after it.
 *
 * Historical values are **not** migrated (owner's ruling, 2026-08-19,
 * originally for the admin pair in !753 and extended to the rest): only two
 * developer environments exist, so re-slugging live rows buys nobody anything,
 * and every one of these values is computed fresh at create time rather than
 * re-derived to look an existing row up. New values are correct from here on.
 *
 * **`pim_ergonode` is the exception the ruling names, and it is the reason
 * `preserve` exists.** Its two derivations are re-derived on every import run
 * *to find the row a previous run created*, so a changed derivation orphans the
 * row rather than improving it. Those values are migrated (issue #260), and the
 * migration is only affordable because the derivation change is confined to the
 * fold — which is what `preserve` buys.
 *
 * `normalizeOrganizationName` is **not** a caller and must not become one: it
 * writes the persisted `organizations.name_search` column, which is a folded
 * name rather than a slug.
 */
export function slugify(input: string, options: SlugifyOptions = {}): string {
  const separator = options.separator ?? '-';
  const escaped = escapeForRegExp(separator);
  const usable = escapeForRegExp(options.preserve ?? '');
  const folded = foldDiacritics(input);
  // Two spellings of one step, and the branch is not a micro-optimisation. The
  // default has to stay a **literal** `.replace(/[^a-z0-9]+/g, …)`, because
  // that expression is what `check:diacritic-folds` reads to know this file is
  // still the slug generator it exempts: its vacuous-pass guard cannot read a
  // pattern built from a template, and a guard that cannot see the owner
  // reports every private copy of it as fine (issue #244's whole point).
  const collapsed = (
    usable.length === 0
      ? folded.replace(/[^a-z0-9]+/g, separator)
      : folded.replace(new RegExp(`[^a-z0-9${usable}]+`, 'g'), separator)
  ).replace(new RegExp(`^(?:${escaped})+`), '');
  const sliced = options.maxLength === undefined ? collapsed : collapsed.slice(0, options.maxLength);
  const trimmed = sliced.replace(new RegExp(`(?:${escaped})+$`), '');
  return trimmed.length > 0 ? trimmed : (options.fallback ?? '');
}
