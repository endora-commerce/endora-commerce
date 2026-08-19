/**
 * CI check — the admin folds diacritics in exactly one place (issue #240).
 *
 * ## The defect, four times in a year
 *
 * `admin/src/lib/text-normalization.ts` exists because the obvious one-liner
 *
 * ```
 * input.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
 * ```
 *
 * is **wrong for Polish** and reads as if it were right. `ł` is U+0142, a
 * standalone code point with no canonical decomposition: NFD leaves it exactly
 * where it was, so the strip has nothing to remove and the fold silently does
 * nothing for every word carrying one. Same for `Ø đ ħ ŧ`. The shared helper
 * hand-maps those stroked letters **before** it decomposes, which is the whole
 * reason it is longer than one line.
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
 * There is no legitimate non-folding reason to decompose a string in this
 * admin. If one arrives — grapheme-aware truncation is the plausible candidate
 * — it goes in the ledger with its reason, not into a widening of the rule.
 *
 * ## Literal nodes, so a comment is out of the population by construction
 *
 * The predicate reads **literal nodes** of the TypeScript AST, in the idiom of
 * `check-module-boundary`'s SQL predicate. That is not an optimisation: the
 * helper's own header quotes the wrong one-liner, `AppShell.tsx` quotes it
 * again to say why it does not use it, and two admin tests quote it a third
 * time. A text-level check reports all four and gets switched off within a
 * week. A node-level one cannot see a comment at all.
 *
 * ## The population, and the four trees that are not in it
 *
 * `admin/src` and `admin/test` — the app that owns the shared helper, and its
 * tests, which can import it just as easily. A test that recomputes an expected
 * value with its own fold is the same defect wearing a test's clothes.
 *
 * Out of the population, each for a stated reason rather than for want of
 * looking (the question was left open by issue #236):
 *
 *   - **`storefront/`** — a separate Next.js app that cannot import from
 *     `admin/src`, and which folds diacritics **nowhere today**: `.normalize(`
 *     has zero occurrences under `storefront/src`. There is no rule for it to
 *     break and no helper for it to break it against.
 *   - **`backend/`** — cannot import `admin/src` either. It does fold, in two
 *     slugifiers (`product_feeds/services/feed-template-io.service.ts`,
 *     `catalog/services/catalog-admin.service.ts`), and both carry the `ł`
 *     bug. They are real defects and are recorded as such in issue #239; they
 *     are not violations *of this rule*, because this rule says "use the shared
 *     helper" and there is no shared helper reachable from a backend module.
 *   - **`packages/`** — `contracts`' `normalizeOrganizationName` is a **correct**
 *     fold: it maps the non-decomposing Latin letters itself, exactly as the
 *     admin helper does. Reporting it would be reporting the repair.
 *   - **`backend/scripts` and this check's own tests** — they must be able to
 *     name the shapes they refuse.
 *
 * Widening the population later means naming a fold every widened tree can
 * reach. That is a design decision, not a regex edit, which is why the reasons
 * are declared as data below rather than left implicit in a glob.
 *
 * ## The exclusion is path-anchored
 *
 * `SHARED_FOLD_HELPER` is one exact repo-relative path. It is deliberately not
 * a name rule ("a file called `text-normalization.ts`") and not a directory
 * rule ("anything under `lib/`"): issue #197's lesson is that a second file can
 * satisfy a name-shaped exemption and thereby appoint itself the owner of the
 * fold, which is the precise failure this check exists to prevent.
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

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

/**
 * The one file allowed to fold, as an exact repo-relative path.
 *
 * Path-anchored on purpose — see the header. A second `text-normalization.ts`
 * elsewhere in the tree is a violation, which is the point.
 */
export const SHARED_FOLD_HELPER = 'admin/src/lib/text-normalization.ts';

/**
 * The trees scanned, and why each is in the population.
 *
 * Declared as data so the reason travels with the decision: a tree that is not
 * here is a tree this check makes no claim about, and the next reader gets to
 * see which claim was dropped rather than inferring it from a glob.
 */
export const POPULATION_ROOTS: Readonly<Record<string, string>> = {
  'admin/src':
    'The app that owns the shared fold. All four private copies (issue #236) ' +
    'grew here, each one an import away from the helper.',
  'admin/test':
    'The same app. A test that recomputes an expected value with its own fold ' +
    'is a fifth copy that happens to be green.',
};

/** File extensions parsed. Anything else is not a module that can import the helper. */
export const SOURCE_EXTENSIONS: readonly string[] = ['.ts', '.tsx'];

/** Directory names pruned wherever they occur under a population root. */
export const SKIPPED_DIRECTORIES: Readonly<Record<string, string>> = {
  node_modules: "Installed dependencies: third-party code, not this repository's source.",
  dist: 'Build output, reproduced from source by the build.',
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
 * **Two-way, and per file by count** — an unledgered fold fails the build, a
 * ledgered file whose count moved fails it too, and an entry naming a file that
 * no longer folds fails it as well. Never raise a number to make the build
 * pass: add the import.
 *
 * It holds exactly the two admin **slugifiers**, and it holds them because
 * their repair is not the import swap every search caller's was. Both are
 * `NFKD`, not `NFD`: `NFKD` additionally folds compatibility characters
 * (`ﬁ` → `fi`, `²` → `2`, full-width forms), so swapping them onto the shared
 * `NFD` helper changes the slug computed for names that contain one — and a
 * slug is **persisted**, in a feed URL an operator has already published and in
 * a newsletter tag code the backend validates. That is a data migration wearing
 * a one-line diff, and it is issue #239's, not this check's.
 *
 * Note what is *not* the reason: "slugs are different from search". They are
 * not — the shared helper's own header names slug generators as one of its two
 * kinds of caller, and `PageEditor`, `BlockEditor` and `BlogPostEditor` already
 * use it. Distinguishing a search fold from a slug fold in the *rule* was
 * considered and rejected: it would have exempted a whole category on the
 * strength of two files whose real problem is the compatibility mapping.
 */
export const DIACRITIC_FOLDS_ALLOWED: Readonly<Record<string, LedgerEntry>> = {
  'admin/src/modules/product_feeds/api.ts': {
    findings: 2,
    reason:
      'Feed slug generator. NFKD, so its compatibility mappings are part of the ' +
      'slug an operator has already published; folding it onto the shared NFD ' +
      'helper renames existing feeds.',
    retiredBy: 'issue #239 — one fold for slugs, with the NFKD migration it needs.',
  },
  'admin/src/modules/newsletter/pages/TagsPage.tsx': {
    findings: 2,
    reason:
      'Newsletter tag/field code generator. The code is persisted and validated ' +
      'against CODE_RE by the backend, so a fold that produces a different code ' +
      'for the same label is a rename of live tags.',
    retiredBy: 'issue #239 — one fold for slugs, with the NFKD migration it needs.',
  },
};

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

  console.log(
    `[diacritic-folds] scanned=${result.scanned} folds-outside-the-helper=${result.total} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(DIACRITIC_FOLDS_ALLOWED).length} stale=${result.stale.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA diacritic fold outside the shared helper (issue #240).\n' +
        `Import { normalize } from '@/lib/text-normalization' instead. The one-liner\n` +
        "`normalize('NFD').replace(/\\p{Diacritic}/gu, '')` reads as complete and is not:\n" +
        '`ł` has no canonical decomposition, so NFD leaves it alone and the strip has\n' +
        'nothing to remove. Four private copies shipped that bug — typing `naglowek`\n' +
        'found no block named `Nagłówek`, and `platnosci` found no `Metody płatności`.\n' +
        'The shared helper hand-maps the stroked letters before it decomposes.\n',
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
