/**
 * CI check — this repository folds diacritics in exactly one place (issue #240).
 *
 * ## The defect, four times in a year
 *
 * `packages/contracts/src/text-normalization.ts` exists because the obvious
 * one-liner
 *
 * ```
 * input.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
 * ```
 *
 * is **wrong for Polish** and reads as if it were right. `ł` is U+0142, a
 * standalone code point with no canonical decomposition: NFD leaves it exactly
 * where it was, so the strip has nothing to remove and the fold silently does
 * nothing for every word carrying one. Same for `Ø đ ð þ ß æ œ`. The shared
 * fold decomposes, strips, and **then** maps those letters, which is the whole
 * reason it is longer than one line. (The map runs last rather than first on
 * purpose: `Ǿ` decomposes to `Ø` plus an acute, so a map applied first never
 * sees the letter the decomposition is about to expose.)
 *
 * Four private copies of the one-liner had grown by issue #236 — the ⌘K
 * palette, the page-builder drawer, the combobox and the multi-select — and
 * every one of them shipped the bug: a Puck block named `Nagłówek` was not
 * found by typing `naglowek`, and `Metody płatności` was not found by typing
 * `platnosci`. They were repaired by !745, and the only thing standing between
 * that repair and a fifth copy was a paragraph in a file header. This check is
 * that paragraph, made executable.
 *
 * ## What it refuses, and why it refuses the decomposition rather than the bug
 *
 * Three literal shapes, anywhere in the population except the helper's own path.
 * The first two are the **explicit** fold:
 *
 *   1. **`decomposition`** — a literal naming a decomposing normalization form,
 *      `NFD` or `NFKD`. `NFC` and `NFKC` are **not** in the rule: they compose,
 *      so they never expose the combining marks a fold goes on to strip.
 *   2. **`diacritic-strip`** — a pattern that removes combining marks: the
 *      `\p{Diacritic}` / `\p{Mn}` / `\p{M}` property escapes, the
 *      `\u0300-\u036f` block range in either escape spelling, and the same
 *      range written as raw combining characters (which is how
 *      `feed-template-io.service.ts` spells it, invisible to a grep for the
 *      escape).
 *
 * It refuses the **decomposition**, not "a decomposition immediately followed
 * by a strip", because a rule with a proximity window is a rule an author
 * escapes by moving one line into a helper — and half of a fold is still a
 * fold. Both halves are reported independently for the same reason: a fold
 * split across two functions leaves each half alone, and each half alone is
 * still a second implementation of the thing that has one owner.
 *
 * There is no legitimate non-folding reason to decompose a string anywhere in
 * this repository. If one arrives — grapheme-aware truncation is the plausible
 * candidate — it goes in the ledger with its reason, not into a widening of the
 * rule.
 *
 * ## The third shape, and why a check needed one (issue #244)
 *
 *   3. **`slug-run`** — a `.replace()` that collapses a **run of characters
 *      outside ASCII alphanumerics** to a separator: `/[^a-z0-9]+/g` to `'-'`,
 *      and the variants below. Slug construction, in other words.
 *
 * The first two signals share a defect that neither of them can see, and it is
 * the reason issue #244 exists: **their population is defined by the presence
 * of the thing they check.** A site that folds nothing writes no `NFD` and no
 * `\p{Diacritic}`, matches neither predicate, is not in the population, and
 * reports clean. Two sites were live on `master` for a year that way —
 * `cms-template-layout.ts`'s `codeFromTemplateName` and `pim_ergonode`'s
 * `slugFromSourceCode` — each going straight from `toLowerCase()` to
 * `[^a-z0-9]+`, so that `Żółw` produced `w`, `Świeże Ćwikła` produced
 * `wie-e-wik-a` and `KAT_ŁĄCZNIKI_01` produced `kat-czniki-01`. That is the
 * exact bug the first two signals exist to catch, and this check printed
 * `violations=0` throughout. Issue #245 repaired the sites; the blindness
 * survived it, because the next hand-rolled slug builder written without a fold
 * would be just as invisible.
 *
 * So the third signal keys on something **present in both the good case and the
 * bad one**: the slug builder itself. A site that folds correctly and one that
 * folds not at all both write the run collapse, so the run collapse is where a
 * missing fold becomes observable. Concretely the rule is *"slug construction
 * has one owner"*, `slugify` in `@endora-commerce/contracts`, and not *"a slug builder must
 * fold"* — which is deliberate, and is what keeps the predicate honest:
 *
 *   - **It needs no dataflow.** "Did the value reaching this `.replace()` pass
 *     through a fold?" cannot be answered by reading the expression: the fold
 *     may be a call up the chain, a caller two frames away, or a local assigned
 *     three statements earlier. A predicate that only read the same expression
 *     would report every correct site that folds elsewhere, and one that
 *     followed the value would have to say where it stops. Keying on the
 *     builder removes the question rather than answering it badly.
 *   - **It is strictly stronger.** `BlogPostEditor`'s local `slugify` folded
 *     correctly via `normalize` and was still the ninth private copy of a
 *     generator that has one owner — issue #245 unified eight and missed it.
 *     This signal reported it, and the repair is this rule's first finding.
 *
 * ### What a run collapse is, and the two spellings of it
 *
 * A `.replace(pattern, separator)` whose pattern holds a **negated character
 * class over ASCII alphanumerics** — `[^a-z0-9]`, `[^a-zA-Z0-9]`,
 * `[^A-Za-z0-9_-]`, `[^\w]`, in a regular-expression literal or in a
 * `new RegExp('...')` — and whose separator is a non-empty string or an
 * identifier. The run itself is either:
 *
 *   - **quantified in place** — `[^a-z0-9]+`, `[^a-z0-9]{2,}`. All eight sites
 *     issue #245 unified were written this way; or
 *   - **collapsed in a second move later in the same call chain** —
 *     `.replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_')`, which is how
 *     `pim_ergonode`'s two key derivations spell it. One expression, so this is
 *     a structural window rather than a line-proximity one.
 *
 * ### The population is honest, and that was measured rather than asserted
 *
 * The obvious wider predicate — *any* negated ASCII-alphanumeric class — matches
 * **9** sites in this tree, and 7 of them legitimately need no fold: a payment
 * hash seed that must not change, an XML element name, a DOM `id`, a
 * Meilisearch index name, a test database name. A ledger that is mostly
 * exceptions teaches people to add entries rather than to think, so that
 * predicate was rejected.
 *
 * Requiring the **run collapse** is what removes them, and it is not a
 * convenience: collapsing a run to one separator is slug grammar, while
 * deleting the run (to `''`) or substituting one-for-one preserves length and
 * position, which is identifier grammar. Measured over the 322 `.replace()`
 * calls whose pattern this check can read, it matches **4** sites — the helper
 * (exempt), one repair and two ledgered —
 * and **none of them is an exception to the rule**: both ledger entries are the
 * same defect deferred for a stated data reason, not sites the rule does not
 * reach. That is the difference the population had to show before this signal
 * was worth shipping.
 *
 * ### What it cannot see, stated here rather than discovered later
 *
 *   - A collapse whose class is not lexically ASCII-alphanumeric:
 *     `new RegExp(variable)`, a class assembled from a template literal, a
 *     builder written with `split`/`join` or `Intl.Segmenter` rather than
 *     `replace`.
 *   - A two-move collapse whose halves sit in **different statements**
 *     (`const a = x.replace(...); return a.replace(/-{2,}/g, '-');`). The window
 *     is one call chain and goes no further, in the idiom of
 *     `check-port-catches`, which follows a gate one hop through `this` and
 *     refuses to go further.
 *   - A bare `[^a-z0-9]` with **no** run collapse anywhere. It still deletes
 *     `ł`, and it is out of the population on purpose: matching it is what pulls
 *     in the seven sanitisers above.
 *   - Whether a matched site **needs** a fold at all. That is a human judgement
 *     and it belongs in a ledger reason, not in a predicate.
 *
 * ## Literal nodes, so a comment is out of the population by construction
 *
 * The predicate reads **literal nodes** of the TypeScript AST, in the idiom of
 * `check-module-boundary`'s SQL predicate. That is not an optimisation: both
 * `text-normalization.ts` files quote the wrong one-liner in their headers,
 * `AppShell.tsx` quotes it again to say why it does not use it, and two admin
 * tests quote it a third time. A text-level check reports all five and gets
 * switched off within a week. A node-level one cannot see a comment at all.
 *
 * ## The population is the whole tree, because the fold is now reachable
 *
 * (This paragraph used to carry a caveat, and the `slug-run` signal above is
 * what retired it: the first two signals see a fold written **outside** the
 * helper, so a slugifier with **no fold step at all** wrote nothing for them to
 * see. Two shipped that way for a year, deleting `ł` rather than folding it,
 * while this check read clean over both. Issue #245's shared `slugify` repaired
 * the sites and this signal closes the hole they went through.)
 *
 * It was `admin/src` and `admin/test` alone when this check landed, and the
 * header said why each other tree was out: none of them could import
 * `admin/src/lib/text-normalization.ts`. That was true and it was the defect,
 * not a property of the trees. The correct fold had been in `@endora-commerce/contracts`
 * the whole time — inside `normalizeOrganizationName`, named after one caller,
 * which is why six authors wrote their own instead of finding it. Issue #240
 * extracted it as `foldDiacritics`, and the four packages below can all import
 * it, so the rule "use the shared fold" now has something to mean everywhere:
 *
 *   - **`admin/`** — where all four private copies grew (issue #236), each an
 *     import away from the helper. `admin/src/lib/text-normalization.ts` is now
 *     a two-line composition over the shared fold, not a second copy of it.
 *   - **`backend/`** — held the last two ledgered folds until issue #245 routed
 *     them, and five more slug generators, through `slugify` in
 *     `@endora-commerce/contracts`. It folds nowhere of its own now, and holds the two
 *     ledgered `slug-run` sites.
 *   - **`storefront/`** — folds nowhere today and builds no slug. It is in the
 *     population so that the first one written there is the one that gets
 *     refused, which is the only moment the rule is cheap to keep.
 *   - **`packages/`** — holds the shared fold and the shared generator, both
 *     excluded by that one exact path. Every other package is scanned like any
 *     other consumer.
 *
 * `EXCLUDED_SUBTREES` names the two places that must be able to write the
 * shapes this check refuses: the checks themselves and their companion tests.
 * Both are declared with reasons rather than pruned by a glob, for the same
 * reason the roots are.
 *
 * Out of the population and staying out: `specs/` (contract sketches, not code
 * that runs) and the repository-root build config, neither of which folds
 * anything.
 *
 * ## The exclusion is path-anchored
 *
 * `SHARED_FOLD_HELPER` is one exact repo-relative path. It is deliberately not
 * a name rule ("a file called `text-normalization.ts`") and not a directory
 * rule ("anything under `lib/`"): issue #197's lesson is that a second file can
 * satisfy a name-shaped exemption and thereby appoint itself the owner of the
 * fold, which is the precise failure this check exists to prevent. There are
 * two files called `text-normalization.ts` in the tree today — the fold in
 * `packages/contracts/` and the admin's trim over it — and exactly one of them
 * is exempt.
 *
 * The same path is the vacuous-pass guard's subject. The helper must exist and
 * must still contain **all three** shapes, or the check exits 2 — because a
 * helper that no longer folds means either the file moved (and the exclusion
 * now exempts nothing) or the analysis stopped seeing folds (and every green
 * after that is worthless). The third shape joined that guard for the same
 * reason and buys one more: `slugify` is what the failure message tells every
 * author to import, so a run in which nothing in the helper parses as a slug
 * builder is a run whose remedy does not exist. A check whose own exemption is
 * its self-test cannot go quietly blind.
 *
 * Usage: `tsx scripts/check-diacritic-folds.ts [--list]`
 * Exit 0 = no unledgered fold and no unledgered slug run; exit 1 = at least
 * one, or a stale ledger entry; exit 2 = nothing was read, so a pass would be
 * vacuous.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { reportReadSize } from './lib/read-size.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * The one file allowed to fold, as an exact repo-relative path.
 *
 * Path-anchored on purpose — see the header. A second `text-normalization.ts`
 * elsewhere in the tree is a violation, which is the point; the admin file of
 * that name is in the population and passes because it imports rather than
 * folds.
 *
 * It moved here from `admin/src/lib/` when issue #240 extracted `foldDiacritics`
 * into `@endora-commerce/contracts`. That move is what let the population widen: an
 * exemption is only worth anything where the exempted file is reachable, and
 * neither `backend/` nor `storefront/` could ever have imported the admin one.
 */
export const SHARED_FOLD_HELPER = 'packages/contracts/src/text-normalization.ts';

/**
 * The trees scanned, and why each is in the population.
 *
 * Declared as data so the reason travels with the decision: a tree that is not
 * here is a tree this check makes no claim about, and the next reader gets to
 * see which claim was dropped rather than inferring it from a glob.
 */
export const POPULATION_ROOTS: Readonly<Record<string, string>> = {
  admin:
    'Where all four private copies grew (issue #236), each one an import away ' +
    'from a fold it could not find. Its own tests are in: a test that recomputes ' +
    'an expected value with its own fold is a fifth copy that happens to be green.',
  backend:
    'Held the last two ledgered folds, both carrying the `l` bug, until issue ' +
    '#245 routed them through the shared slug generator. It folds nowhere of ' +
    'its own now, and is scanned so the next one written here is refused.',
  storefront:
    'Folds nowhere today, which is exactly when a rule is cheap to keep: the ' +
    'first fold written here is refused before it can be copied.',
  packages:
    'Holds the shared fold itself, exempt by exact path. Every other package is ' +
    'a consumer like any other and is scanned like one.',
};

/** File extensions parsed. Anything else is not a module that can import the helper. */
export const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx'];

/**
 * Subtrees inside a population root that are excluded, with the reason.
 *
 * Both entries are places that must be able to **write** the shapes this check
 * refuses, because naming them is their job. They are exact path prefixes, not
 * a `scripts` directory-name rule: a module directory called `scripts` would
 * silently exempt itself under the latter, which is issue #197's lesson applied
 * one level up from `SHARED_FOLD_HELPER`.
 */
export const EXCLUDED_SUBTREES: Readonly<Record<string, string>> = {
  'backend/scripts':
    'The checks themselves, this one included. A check that cannot spell the ' +
    'pattern it refuses cannot refuse it.',
  'backend/test/unit/scripts':
    "The checks' companion tests. Every fixture in them is a deliberate " +
    'spelling of a refused shape, and a red proof that cannot be written is ' +
    'issue #130 restated.',
};

/** Directory names pruned wherever they occur under a population root. */
export const SKIPPED_DIRECTORIES: Readonly<Record<string, string>> = {
  node_modules: "Installed dependencies: third-party code, not this repository's source.",
  dist: 'Build output, reproduced from source by the build.',
  '.next': "Next.js build output, regenerated by the storefront's build.",
  coverage: 'Coverage report output, regenerated by every run.',
};

/** What a ledger entry has to say for itself. */
export interface LedgerEntry {
  /** How many findings the file carries today. A two-way, per-file count ratchet. */
  readonly findings: number;
  /** Why this fold is not simply an import of the shared helper. */
  readonly reason: string;
  /** The condition that deletes this entry. */
  readonly retiredBy: string;
}

/**
 * Folds outside the helper that are not (yet) violations, with the reason.
 *
 * **Empty, and a two-way ratchet.** An unledgered fold fails the build, a
 * ledgered file whose count moved fails it too, and an entry naming a file that
 * no longer folds fails it as well — which is how the last two entries left:
 * issue #245 repaired them and the staleness half went red until they were
 * deleted. Never raise a number to make the build pass: add the import.
 *
 * It opened with four entries, two in `admin/` and two in `backend/`, and every
 * one of them was retired by the same owner ruling (2026-08-19): new values are
 * to be correct, historical ones are **not** migrated, because only two
 * developer environments exist and re-slugging live rows buys nobody anything.
 * !753 took the admin pair, and issue #245 took the backend pair along with the
 * five other slug generators the sweep for them turned up.
 *
 * Note what is *not* a reason to add one back: "slugs are different from
 * search". They are not — the whole family this check exists for is slug
 * generators, and since issue #245 all eight of them compose `slugify` from
 * `@endora-commerce/contracts`, which composes `foldDiacritics`. Nor is "the value is
 * already persisted": that is an argument for not *migrating* the old rows,
 * which is the owner's standing ruling, and not an argument for computing the
 * next one wrongly.
 *
 * This ledger covers the two **explicit** fold shapes only. The `slug-run`
 * signal has its own, {@link SLUG_RUNS_ALLOWED}, because the two answer
 * different questions — "why is this fold not an import of the helper" against
 * "why is this generator not an import of `slugify`" — and a single per-file
 * count over both kinds would make "never raise a number" ambiguous the first
 * time one file carried one of each.
 */
export const DIACRITIC_FOLDS_ALLOWED: Readonly<Record<string, LedgerEntry>> = {};

/**
 * Slug builders outside the helper that are not (yet) violations, with the
 * reason (issue #244).
 *
 * **Two-way and per file by count**, exactly like the fold ledger above: an
 * unledgered run collapse fails the build, a ledgered file whose count moved
 * fails it too, and an entry naming a file that no longer builds a slug fails
 * as well. Never raise a number to make the build pass — call `slugify`.
 *
 * **Empty since issue #260.** It opened with the two `pim_ergonode` key
 * derivations, and they were never exceptions to the rule — they were the same
 * defect deferred, on the ground that repairing it was a data decision rather
 * than a code one. What made it a data decision, and what separated them from
 * the eight sites issue #245 simply repaired: those eight compute a value
 * **once, at create time**, and find the row again by a stored mapping, while
 * these two are re-derived on **every run** in order to find an existing row.
 * Changing the derivation therefore did not produce a better key for the next
 * import; it produced a **second** attribute beside every Polish-coded one.
 *
 * The owner took that decision (2026-08-19, "do it properly"). The derivations
 * now compose `slugify` — the option value with `preserve: '-'`, since its
 * stored grammar has two usable punctuation characters — and
 * `…_pim_ergonode_fold_derived_keys.ts` re-derives every imported attribute key
 * and renames the rows, collisions the fold creates included.
 *
 * Note what is **not** a reason to add an entry back: "this value is a lookup
 * key". That was this ledger's whole content and it is now a statement about
 * what a repair costs, not about whether one is owed. A derived lookup key
 * whose input is persisted can be migrated; one whose input is not persisted
 * should be storing its input.
 */
export const SLUG_RUNS_ALLOWED: Readonly<Record<string, LedgerEntry>> = {};

/** Which shape a finding is. */
export type FoldKind =
  /** A literal naming `NFD` or `NFKD`. */
  | 'decomposition'
  /** A pattern that strips combining marks. */
  | 'diacritic-strip'
  /**
   * A `.replace()` collapsing a run of non-ASCII-alphanumerics to a separator —
   * slug construction, which has one owner. This is the shape that is present
   * whether or not the site folds, which is what makes a missing fold
   * observable (issue #244).
   */
  | 'slug-run';

/** The two explicit-fold kinds, which {@link DIACRITIC_FOLDS_ALLOWED} answers for. */
export const EXPLICIT_FOLD_KINDS: ReadonlySet<FoldKind> = new Set<FoldKind>([
  'decomposition',
  'diacritic-strip',
]);

/** Which ledger answers for a finding of this kind. */
export function ledgerFor(
  kind: FoldKind,
  folds: Readonly<Record<string, LedgerEntry>>,
  slugRuns: Readonly<Record<string, LedgerEntry>>,
): Readonly<Record<string, LedgerEntry>> {
  return EXPLICIT_FOLD_KINDS.has(kind) ? folds : slugRuns;
}

export interface FoldFinding {
  /** Repo-relative path, POSIX separators — also the ledger key. */
  readonly path: string;
  readonly kind: FoldKind;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column: number;
  /** The literal's own text, so the report names what it saw. */
  readonly literal: string;
}

/** The decomposing normalization forms. `NFC` / `NFKC` compose and are not folds. */
const DECOMPOSING_FORMS: ReadonlySet<string> = new Set(['NFD', 'NFKD']);

/**
 * Spellings of "remove the combining marks".
 *
 * Every one of them appears in this tree or in a repaired copy of it. The raw
 * range matters most: `feed-template-io.service.ts` writes the class with the
 * combining characters themselves rather than with escapes, so a check grepping
 * for `\u0300` reads that file clean.
 */
const DIACRITIC_PATTERNS: readonly RegExp[] = [
  /\\p\{Diacritic\}/u,
  /\\p\{Mn\}/u,
  /\\p\{Nonspacing_Mark\}/u,
  /\\p\{M\}/u,
  /\\p\{Mark\}/u,
  /\\p\{InCombiningDiacriticalMarks\}/u,
  // The U+0300–U+036F block, in both escape spellings and in either case.
  /\\u\{?0*300\}?\s*-\s*\\u\{?0*36[fF]\}?/u,
  // The same range written as the characters themselves.
  /[\u0300-\u036f]\s*-\s*[\u0300-\u036f]/u,
];

/** Does this literal's text name a combining-mark class? */
export function isDiacriticPattern(text: string): boolean {
  return DIACRITIC_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * A negated character class, tolerating an escaped `]` inside it.
 *
 * `[^\]a-z0-9]` is legal and rare; a naive `\[\^[^\]]*\]` stops at the escaped
 * bracket and reads the class as `[^\]`, which holds no ranges and so silently
 * clears the site. Consuming `\\.` first is one character of regex and removes
 * the whole shape from the "cannot see" list.
 */
const NEGATED_CLASS = /\[\^((?:\\.|[^\]\\])*)\]/;

/** The quantifier that turns a class into a **run**: `+`, `{2,}`, `{1,4}`. */
const RUN_QUANTIFIER = /^(?:\+|\{\d+,\d*\})/;

/** A negated class this check reads as "everything outside ASCII alphanumerics". */
export interface NegatedAsciiClass {
  /** The class as written, quantifier included where it carries one. */
  readonly text: string;
  /** True when the class itself is quantified, so the run collapses in one move. */
  readonly quantified: boolean;
}

/**
 * The negated ASCII-alphanumeric class in a pattern's source, if it has one.
 *
 * "ASCII alphanumeric" is a letter range **and** a digit range (`a-z0-9`,
 * `a-zA-Z0-9`, `A-Za-z0-9_-`), or the `\w` shorthand, which is the same set
 * plus `_`. Extra members are allowed and are the norm — six of the nine sites
 * measured keep `_` or `-` — because what matters is that every character
 * outside ASCII is on the wrong side of the negation.
 *
 * A class that names **Unicode** properties is deliberately not one of these:
 * `[^\p{L}\p{N}]` keeps its accented letters, so it is not the defect and not in
 * the population.
 */
export function negatedAsciiClass(pattern: string): NegatedAsciiClass | undefined {
  const match = NEGATED_CLASS.exec(pattern);
  if (match === null) return undefined;
  const members = match[1] ?? '';
  const asciiAlphanumeric =
    (/a-z/i.test(members) && /0-9/.test(members)) || /\\w/.test(members);
  if (!asciiAlphanumeric) return undefined;
  const tail = pattern.slice(match.index + match[0].length);
  const quantifier = RUN_QUANTIFIER.exec(tail);
  return {
    text: `${match[0]}${quantifier?.[0] ?? ''}`,
    quantified: quantifier !== null,
  };
}

/** Escape a literal so it can be matched inside a constructed pattern. */
function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * Does this pattern collapse a **run of the separator** — `/-+/`, `/_{2,}/`,
 * `/[-]+$/`?
 *
 * This is the second half of the two-move spelling. An anchored edge trim
 * (`/^-+/`, `/-+$/`) counts, and that is a decision rather than an oversight: a
 * site that emits a separator and then quantifies it anywhere is producing a
 * separator-delimited value, which is the grammar the rule is about. It changes
 * no finding on the tree this landed against, where the two two-move sites both
 * spell it `/_{2,}/`.
 */
export function collapsesSeparatorRun(pattern: string, separator: string): boolean {
  if (separator.length === 0) return false;
  const escaped = escapeForRegExp(separator);
  return new RegExp(`(?:\\[${escaped}\\]|${escaped})(?:\\+|\\{\\d+,\\d*\\})`).test(pattern);
}

/**
 * The pattern source of a `.replace()`'s first argument, where it is literal.
 *
 * A regular-expression literal (its body, without the delimiters and flags) or a
 * `new RegExp('…')` built from a string. A **bare string** first argument is not
 * one: `replace` treats it as a literal substring rather than a pattern, so
 * `'[^a-z0-9]+'` there matches those characters verbatim and collapses nothing.
 */
export function replacePatternSource(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (ts.isRegularExpressionLiteral(node)) {
    const end = node.text.lastIndexOf('/');
    return end > 0 ? node.text.slice(1, end) : undefined;
  }
  if (ts.isNewExpression(node) && node.expression.getText(file) === 'RegExp') {
    const first = node.arguments?.[0];
    return first !== undefined && ts.isStringLiteralLike(first) ? first.text : undefined;
  }
  return undefined;
}

/**
 * The separator a `.replace()` writes, where it is one.
 *
 * A non-empty string literal, or an identifier / property access — `slugify`
 * itself writes `.replace(/[^a-z0-9]+/g, separator)`, and a copy of it would
 * too. `''` is **not** a separator: deleting a run preserves nothing and is the
 * shape four legitimate sanitisers in this tree use. A replacer *function* is
 * not one either; nothing in the population writes a slug that way.
 *
 * Returns `null` for the identifier case, which is a separator whose text this
 * check does not know — enough for the one-move spelling, not enough to look for
 * a second move over it.
 */
export function replaceSeparator(node: ts.Node): string | null | undefined {
  if (ts.isStringLiteralLike(node)) return node.text.length > 0 ? node.text : undefined;
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) return null;
  return undefined;
}

/**
 * Is there a later `.replace()` in the **same call chain** that collapses a run
 * of `separator`?
 *
 * The window is one expression and stops there. A collapse split across two
 * statements is out of the population, and the header says so rather than
 * leaving a reader to find out — the same bound `check-port-catches` draws when
 * it follows a gate one hop through `this` and no further.
 */
function chainCollapsesSeparator(
  call: ts.CallExpression,
  separator: string,
  file: ts.SourceFile,
): boolean {
  let current: ts.Node = call;
  while (
    ts.isPropertyAccessExpression(current.parent) &&
    current.parent.expression === current &&
    ts.isCallExpression(current.parent.parent) &&
    current.parent.parent.expression === current.parent
  ) {
    const access = current.parent;
    const next = current.parent.parent;
    if (access.name.text === 'replace' && next.arguments.length === 2) {
      const pattern = replacePatternSource(next.arguments[0]!, file);
      if (pattern !== undefined && collapsesSeparatorRun(pattern, separator)) return true;
    }
    current = next;
  }
  return false;
}

/**
 * Is this call a slug run — a `.replace()` collapsing everything outside ASCII
 * alphanumerics to a separator?
 *
 * Exported so a red proof can enter here as well as at {@link analyzeSource}.
 * Returns the class as written, which is what the failure message names.
 */
export function slugRunOf(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (node.expression.name.text !== 'replace' || node.arguments.length !== 2) return undefined;
  const pattern = replacePatternSource(node.arguments[0]!, file);
  if (pattern === undefined) return undefined;
  const negated = negatedAsciiClass(pattern);
  if (negated === undefined) return undefined;
  const separator = replaceSeparator(node.arguments[1]!);
  if (separator === undefined) return undefined;
  if (negated.quantified) return negated.text;
  if (separator === null) return undefined;
  return chainCollapsesSeparator(node, separator, file) ? negated.text : undefined;
}

/** What one file's analysis yields: its findings, and the population it judged. */
export interface FileAnalysis {
  readonly findings: readonly FoldFinding[];
  /**
   * How many `.replace()` calls the slug predicate judged — the check's `sites=`
   * number (issue #244).
   *
   * It counts the **population**, not the findings: every two-argument
   * `.replace()` whose pattern this check can read, whether or not it turned out
   * to be a slug run. A number that moved with the findings would answer the
   * wrong question, which is the mistake `check-entry-scope` had already made
   * once when it printed the files that hold an entry site rather than the files
   * it opened.
   */
  readonly replaceSites: number;
}

/** Is this path in the population — a source file under a root, not the helper? */
export function isScannablePath(path: string): boolean {
  if (path === SHARED_FOLD_HELPER) return false;
  if (!SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension))) return false;
  if (Object.keys(EXCLUDED_SUBTREES).some((subtree) => path.startsWith(`${subtree}/`))) {
    return false;
  }
  const segments = path.split('/');
  if (segments.slice(0, -1).some((segment) => SKIPPED_DIRECTORIES[segment] !== undefined)) {
    return false;
  }
  return Object.keys(POPULATION_ROOTS).some((root) => path.startsWith(`${root}/`));
}

/**
 * One file's source, analysed once.
 *
 * **This is the top of the analysis**: source text in, findings and the judged
 * population out. It parses rather than greps, so a `normalize('NFD')` quoted in
 * a doc block — which four files in this tree do, on purpose, to explain why
 * they do not use it — is not a literal node and cannot be seen. The same holds
 * for the third signal: a doc block quoting `.replace(/[^a-z0-9]+/g, '-')` to
 * explain the defect is not a call node.
 *
 * One parse for all three signals, and for the site count: two walks over the
 * same tree would let the population and the findings drift apart, which is the
 * one thing `sites=` exists to prevent.
 */
export function analyzeFile(source: string, path: string): FileAnalysis {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: FoldFinding[] = [];
  let replaceSites = 0;

  const at = (node: ts.Node): { line: number; column: number } => {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    return { line: position.line + 1, column: position.character + 1 };
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      if (DECOMPOSING_FORMS.has(node.text)) {
        found.push({ path, kind: 'decomposition', ...at(node), literal: node.text });
      } else if (isDiacriticPattern(node.text)) {
        // `new RegExp('\\p{Diacritic}', 'gu')` — the pattern arrives as a string.
        found.push({ path, kind: 'diacritic-strip', ...at(node), literal: node.text });
      }
    } else if (ts.isRegularExpressionLiteral(node) && isDiacriticPattern(node.text)) {
      found.push({ path, kind: 'diacritic-strip', ...at(node), literal: node.text });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'replace' &&
      node.arguments.length === 2 &&
      replacePatternSource(node.arguments[0]!, file) !== undefined
    ) {
      replaceSites += 1;
      const slugRun = slugRunOf(node, file);
      if (slugRun !== undefined) {
        found.push({ path, kind: 'slug-run', ...at(node), literal: slugRun });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return { findings: found, replaceSites };
}

/**
 * The findings alone — the shape a red proof asserts against.
 *
 * Kept as its own export because every proof in the companion test and in the
 * inventory enters here, with source text, which is the anchoring issue #130
 * asks for.
 */
export function analyzeSource(source: string, path: string): FoldFinding[] {
  return [...analyzeFile(source, path).findings];
}

/** A file handed to the analysis: repo-relative POSIX path plus its source text. */
export interface ScannedFile {
  readonly path: string;
  readonly source: string;
}

/** Every finding among the scannable files, in path order. */
export function findDiacriticFolds(files: Iterable<ScannedFile>): FoldFinding[] {
  const found: FoldFinding[] = [];
  for (const file of files) {
    if (!isScannablePath(file.path)) continue;
    found.push(...analyzeSource(file.source, file.path));
  }
  found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);
  return found;
}

/** A ledger entry that no longer describes the file it names, and how. */
export interface StaleEntry {
  readonly path: string;
  readonly declared: number;
  readonly actual: number;
  /** Which ledger the entry sits in, so the report names the file to edit. */
  readonly ledger: 'folds' | 'slug-runs';
}

export interface CheckResult {
  /** Files the analysis actually inspected — the vacuous-pass guard reads this. */
  readonly scanned: number;
  /** `.replace()` calls the slug predicate judged — the `sites=` population. */
  readonly replaceSites: number;
  readonly total: number;
  readonly violations: readonly FoldFinding[];
  readonly ledgered: readonly FoldFinding[];
  readonly stale: readonly StaleEntry[];
}

export function checkDiacriticFolds(
  files: Iterable<ScannedFile>,
  ledger: Readonly<Record<string, LedgerEntry>> = DIACRITIC_FOLDS_ALLOWED,
  slugLedger: Readonly<Record<string, LedgerEntry>> = SLUG_RUNS_ALLOWED,
): CheckResult {
  const scannable = [...files].filter((file) => isScannablePath(file.path));
  const all: FoldFinding[] = [];
  let replaceSites = 0;
  for (const file of scannable) {
    const analysis = analyzeFile(file.source, file.path);
    all.push(...analysis.findings);
    replaceSites += analysis.replaceSites;
  }
  all.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);

  // Counted per ledger, not per file: the two answer different questions, so a
  // file carrying one of each is two independent entries rather than one
  // ambiguous number.
  const foldCounts = new Map<string, number>();
  const slugCounts = new Map<string, number>();
  for (const finding of all) {
    const counts = EXPLICIT_FOLD_KINDS.has(finding.kind) ? foldCounts : slugCounts;
    counts.set(finding.path, (counts.get(finding.path) ?? 0) + 1);
  }

  const stale: StaleEntry[] = [];
  for (const [path, entry] of Object.entries(ledger)) {
    const actual = foldCounts.get(path) ?? 0;
    if (actual !== entry.findings) {
      stale.push({ path, declared: entry.findings, actual, ledger: 'folds' });
    }
  }
  for (const [path, entry] of Object.entries(slugLedger)) {
    const actual = slugCounts.get(path) ?? 0;
    if (actual !== entry.findings) {
      stale.push({ path, declared: entry.findings, actual, ledger: 'slug-runs' });
    }
  }

  const isLedgered = (finding: FoldFinding): boolean =>
    ledgerFor(finding.kind, ledger, slugLedger)[finding.path] !== undefined;

  return {
    scanned: scannable.length,
    replaceSites,
    total: all.length,
    violations: all.filter((finding) => !isLedgered(finding)),
    ledgered: all.filter(isLedgered),
    stale: stale.sort((a, b) => a.path.localeCompare(b.path) || a.ledger.localeCompare(b.ledger)),
  };
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRECTORIES[name] !== undefined) continue;
    const full = join(dir, name);
    // A dangling symlink must not abort the walk, hence `throwIfNoEntry`.
    const stat = statSync(full, { throwIfNoEntry: false });
    if (stat === undefined) continue;
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

/**
 * Is the excluded helper still the owner of all three shapes?
 *
 * The exemption and the self-test are the same path on purpose. If the helper
 * has moved, the exclusion exempts nothing and the real fold is now being
 * reported at its new home; if the helper is there but the analysis finds no
 * fold in it, the analysis has gone blind and every green it reports afterwards
 * is vacuous. Either way the answer is exit 2, not exit 0.
 *
 * The `slug-run` shape joined the guard with issue #244, and it earns its place
 * twice over. It is the third predicate, so it is a third way for the analysis
 * to go blind unnoticed. And `slugify` is what every `slug-run` failure message
 * tells the author to import: a run in which nothing in the helper parses as a
 * slug builder is a run whose remedy does not exist, which is worth an exit 2
 * on its own.
 *
 * It was named `helperStillFolds` until then. The rename is the point of the
 * widening: a function reporting `false` because `slugify` was deleted, under a
 * name that says "folds", is the sort of quiet mismatch this file exists to
 * refuse.
 */
export function helperIsStillTheOwner(source: string): boolean {
  const kinds = new Set(analyzeSource(source, SHARED_FOLD_HELPER).map((finding) => finding.kind));
  return kinds.has('decomposition') && kinds.has('diacritic-strip') && kinds.has('slug-run');
}

function main(): void {
  const listMode = process.argv.includes('--list');

  const helperPath = join(REPO_ROOT, SHARED_FOLD_HELPER);
  if (!existsSync(helperPath)) {
    console.error(
      `[diacritic-folds] the shared fold helper is not at ${SHARED_FOLD_HELPER} — the ` +
        'path-anchored exclusion exempts nothing and this run would be vacuous',
    );
    process.exit(2);
  }
  if (!helperIsStillTheOwner(readFileSync(helperPath, 'utf8'))) {
    console.error(
      `[diacritic-folds] ${SHARED_FOLD_HELPER} no longer parses as both the fold and the ` +
        'slug generator — either it stopped being the owner of them or this analysis went ' +
        'blind, and the import every failure message names would not exist; refusing to ' +
        'report a vacuous pass',
    );
    process.exit(2);
  }

  const files: ScannedFile[] = [];
  for (const root of Object.keys(POPULATION_ROOTS)) {
    for (const full of walk(join(REPO_ROOT, root))) {
      const path = relative(REPO_ROOT, full).split('\\').join('/');
      if (!isScannablePath(path)) continue;
      files.push({ path, source: readFileSync(full, 'utf8') });
    }
  }

  const result = checkDiacriticFolds(files);
  if (result.scanned === 0) {
    console.error(
      '[diacritic-folds] no source file under any population root — refusing to report a ' +
        'vacuous pass',
    );
    process.exit(2);
  }

  if (listMode) {
    for (const finding of findDiacriticFolds(files)) {
      const ledgered =
        ledgerFor(finding.kind, DIACRITIC_FOLDS_ALLOWED, SLUG_RUNS_ALLOWED)[finding.path] !==
        undefined;
      const tag = ledgered ? 'LEDGERED' : 'FINDING ';
      console.log(
        `${tag} ${finding.path}:${finding.line}:${finding.column} ${finding.kind} ${finding.literal}`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244) — and this check is the
  // one that filed it. `files` says whether the four population roots were
  // walked at all; `sites` is the number the third signal exists for, because
  // the first two have a population defined by the presence of a fold and a
  // site that folds nothing is in neither. It counts every `.replace()` whose
  // pattern the slug predicate could read, cleared ones included, so it never
  // moves with the findings. `self-reported`: nothing in the tree derives "every
  // file that should be scanned for a fold" — a fold is legal anywhere, which is
  // the whole of issue #240.
  reportReadSize({
    prefix: '[diacritic-folds]',
    files: result.scanned,
    sites: result.replaceSites,
  });
  console.log(
    `[diacritic-folds] scanned=${result.scanned} findings-outside-the-helper=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `fold-ledger-size=${Object.keys(DIACRITIC_FOLDS_ALLOWED).length} ` +
      `slug-ledger-size=${Object.keys(SLUG_RUNS_ALLOWED).length} stale=${result.stale.length}`,
  );

  const folds = result.violations.filter((finding) => EXPLICIT_FOLD_KINDS.has(finding.kind));
  const slugRuns = result.violations.filter((finding) => finding.kind === 'slug-run');

  if (folds.length > 0) {
    console.error(
      '\nA diacritic fold outside the shared helper (issue #240).\n' +
        `Import { foldDiacritics } from '@endora-commerce/contracts' instead — or, in the admin,\n` +
        `{ normalize } from '@/lib/text-normalization', which is that fold plus a trim.\n` +
        'The one-liner\n' +
        "`normalize('NFD').replace(/\\p{Diacritic}/gu, '')` reads as complete and is not:\n" +
        '`ł` has no canonical decomposition, so NFD leaves it alone and the strip has\n' +
        'nothing to remove. Four private copies shipped that bug — typing `naglowek`\n' +
        'found no block named `Nagłówek`, and `platnosci` found no `Metody płatności`.\n' +
        'The shared fold decomposes, strips, and then maps the letters NFD left\n' +
        'standing — which is the step the one-liner is missing.\n',
    );
    for (const finding of folds) {
      console.error(
        `  - ${finding.path}:${finding.line}:${finding.column}  ${finding.kind}  ${finding.literal}`,
      );
    }
  }
  if (slugRuns.length > 0) {
    console.error(
      '\nA slug built outside the shared generator (issue #244).\n' +
        `Import { slugify } from '@endora-commerce/contracts' instead. It takes the caller's own\n` +
        'policy — { separator, maxLength, fallback } — and nothing else is negotiable,\n' +
        'because the step a hand-rolled chain leaves out is always the same one:\n' +
        'collapsing everything outside `[a-z0-9]` **deletes** every non-ASCII letter\n' +
        'unless the value was folded first. `Żółw` becomes `w`, `Świeże Ćwikła` becomes\n' +
        '`wie-e-wik-a`, `KAT_ŁĄCZNIKI_01` becomes `kat-czniki-01`. Two sites shipped that\n' +
        'way for a year and no check could see them, because a site that folds nothing\n' +
        'writes no fold to find — which is why this rule keys on the slug builder\n' +
        'instead. If the value here is already persisted and re-deriving it would\n' +
        'rename live rows, that is a ledger entry with a reason, not a second copy.\n',
    );
    for (const finding of slugRuns) {
      console.error(
        `  - ${finding.path}:${finding.line}:${finding.column}  ${finding.kind}  ${finding.literal}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries — the file no longer carries what the entry declares.\n' +
        'If they were repaired, delete the entry. Never raise a number to make the build pass.',
    );
    for (const entry of result.stale) {
      console.error(
        `  - [${entry.ledger}] ${entry.path}: declared ${entry.declared}, found ${entry.actual}`,
      );
    }
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
