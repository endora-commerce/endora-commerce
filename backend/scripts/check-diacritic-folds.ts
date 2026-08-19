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
 * Two literal shapes, anywhere in the population except the helper's own path:
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
 * (And note the limit of that claim, which issue #245 measured: this check sees
 * a fold written **outside** the helper, so a slugifier with **no fold step at
 * all** writes nothing for it to see. Two shipped that way for a year, deleting
 * `ł` rather than folding it, while this check read clean over both. What
 * closes that gap is `slugify` in `@b2b/contracts` — one generator every slug
 * site composes — not a widening of this rule.)
 *
 * It was `admin/src` and `admin/test` alone when this check landed, and the
 * header said why each other tree was out: none of them could import
 * `admin/src/lib/text-normalization.ts`. That was true and it was the defect,
 * not a property of the trees. The correct fold had been in `@b2b/contracts`
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
 *     `@b2b/contracts`. It folds nowhere of its own now.
 *   - **`storefront/`** — folds nowhere today. It is in the population so that
 *     the first fold written there is the one that gets refused, which is the
 *     only moment the rule is cheap to keep.
 *   - **`packages/`** — holds the shared fold itself, excluded by exact path.
 *     Every other package is scanned like any other consumer.
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
 * must still contain **both** shapes, or the check exits 2 — because a helper
 * that no longer folds means either the file moved (and the exclusion now
 * exempts nothing) or the analysis stopped seeing folds (and every green after
 * that is worthless). A check whose own exemption is its self-test cannot go
 * quietly blind.
 *
 * Usage: `tsx scripts/check-diacritic-folds.ts [--list]`
 * Exit 0 = no unledgered fold; exit 1 = at least one, or a stale ledger entry;
 * exit 2 = nothing was read, so a pass would be vacuous.
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
 * into `@b2b/contracts`. That move is what let the population widen: an
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
 * `@b2b/contracts`, which composes `foldDiacritics`. Nor is "the value is
 * already persisted": that is an argument for not *migrating* the old rows,
 * which is the owner's standing ruling, and not an argument for computing the
 * next one wrongly.
 *
 * And note what this check **cannot** see, so an empty ledger is not read as
 * more than it is: it counts folds written *outside* the helper, so a slugifier
 * with no fold step at all is invisible to it. Two were —
 * `cms-template-layout.ts` and `pim_ergonode`'s `slugFromSourceCode`, both
 * deleting `ł` rather than folding it, neither ever reported here. What closes
 * that gap is the shared generator, not this list.
 */
export const DIACRITIC_FOLDS_ALLOWED: Readonly<Record<string, LedgerEntry>> = {};

/** Which half of a fold a finding is. */
export type FoldKind =
  /** A literal naming `NFD` or `NFKD`. */
  | 'decomposition'
  /** A pattern that strips combining marks. */
  | 'diacritic-strip';

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
 * Every fold half in one file's source.
 *
 * **This is the top of the analysis**: source text in, findings out. It parses
 * rather than greps, so a `normalize('NFD')` quoted in a doc block — which four
 * files in this tree do, on purpose, to explain why they do not use it — is not
 * a literal node and cannot be seen.
 */
export function analyzeSource(source: string, path: string): FoldFinding[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: FoldFinding[] = [];

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
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/** A file handed to the analysis: repo-relative POSIX path plus its source text. */
export interface ScannedFile {
  readonly path: string;
  readonly source: string;
}

/** Every fold half among the scannable files, in path order. */
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
}

export interface CheckResult {
  /** Files the analysis actually inspected — the vacuous-pass guard reads this. */
  readonly scanned: number;
  readonly total: number;
  readonly violations: readonly FoldFinding[];
  readonly ledgered: readonly FoldFinding[];
  readonly stale: readonly StaleEntry[];
}

export function checkDiacriticFolds(
  files: Iterable<ScannedFile>,
  ledger: Readonly<Record<string, LedgerEntry>> = DIACRITIC_FOLDS_ALLOWED,
): CheckResult {
  const scannable = [...files].filter((file) => isScannablePath(file.path));
  const all = findDiacriticFolds(scannable);

  const counts = new Map<string, number>();
  for (const finding of all) counts.set(finding.path, (counts.get(finding.path) ?? 0) + 1);

  const stale: StaleEntry[] = [];
  for (const [path, entry] of Object.entries(ledger)) {
    const actual = counts.get(path) ?? 0;
    if (actual !== entry.findings) stale.push({ path, declared: entry.findings, actual });
  }

  return {
    scanned: scannable.length,
    total: all.length,
    violations: all.filter((finding) => ledger[finding.path] === undefined),
    ledgered: all.filter((finding) => ledger[finding.path] !== undefined),
    stale: stale.sort((a, b) => a.path.localeCompare(b.path)),
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
 * Is the excluded helper still the file that folds?
 *
 * The exemption and the self-test are the same path on purpose. If the helper
 * has moved, the exclusion exempts nothing and the real fold is now being
 * reported at its new home; if the helper is there but the analysis finds no
 * fold in it, the analysis has gone blind and every green it reports afterwards
 * is vacuous. Either way the answer is exit 2, not exit 0.
 */
export function helperStillFolds(source: string): boolean {
  const kinds = new Set(analyzeSource(source, SHARED_FOLD_HELPER).map((finding) => finding.kind));
  return kinds.has('decomposition') && kinds.has('diacritic-strip');
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
  if (!helperStillFolds(readFileSync(helperPath, 'utf8'))) {
    console.error(
      `[diacritic-folds] ${SHARED_FOLD_HELPER} no longer parses as a fold — either it ` +
        'stopped being the owner of the fold or this analysis went blind; refusing to ' +
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
      const tag = DIACRITIC_FOLDS_ALLOWED[finding.path] !== undefined ? 'LEDGERED' : 'FOLD    ';
      console.log(
        `${tag} ${finding.path}:${finding.line}:${finding.column} ${finding.kind} ${finding.literal}`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244) — and this check is the
  // one that filed it: its population is defined by the *presence* of a fold,
  // so a slugifier with no fold at all matches nothing and reports clean. The
  // file count cannot see that either, but it is the number that says whether
  // the four population roots were walked at all. `self-reported`: there is no
  // independent derivation of "every file that should be scanned for a fold".
  reportReadSize({ prefix: '[diacritic-folds]', files: result.scanned });
  console.log(
    `[diacritic-folds] scanned=${result.scanned} folds-outside-the-helper=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(DIACRITIC_FOLDS_ALLOWED).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA diacritic fold outside the shared helper (issue #240).\n' +
        `Import { foldDiacritics } from '@b2b/contracts' instead — or, in the admin,\n` +
        `{ normalize } from '@/lib/text-normalization', which is that fold plus a trim.\n` +
        'The one-liner\n' +
        "`normalize('NFD').replace(/\\p{Diacritic}/gu, '')` reads as complete and is not:\n" +
        '`ł` has no canonical decomposition, so NFD leaves it alone and the strip has\n' +
        'nothing to remove. Four private copies shipped that bug — typing `naglowek`\n' +
        'found no block named `Nagłówek`, and `platnosci` found no `Metody płatności`.\n' +
        'The shared fold decomposes, strips, and then maps the letters NFD left\n' +
        'standing — which is the step the one-liner is missing.\n',
    );
    for (const finding of result.violations) {
      console.error(
        `  - ${finding.path}:${finding.line}:${finding.column}  ${finding.kind}  ${finding.literal}`,
      );
    }
  }
  if (result.stale.length > 0) {
    console.error(
      '\nStale ledger entries — the file no longer carries the folds the entry declares.\n' +
        'If they were repaired, delete the entry. Never raise a number to make the build pass.',
    );
    for (const entry of result.stale) {
      console.error(`  - ${entry.path}: declared ${entry.declared}, found ${entry.actual}`);
    }
  }

  process.exit(result.violations.length > 0 || result.stale.length > 0 ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
