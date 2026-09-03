/**
 * CI check — this repository folds diacritics, and builds a slug, in exactly one
 * place (issues #240, #245). **Repository-scope host** over the relocated
 * analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/diacritic-folds.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its three signals, its population predicate and its walk. This
 * file supplies this repository's four population roots and holds both ledgers
 * below: a ledger is a statement about *this* tree's debt and does not travel.
 * The forwarding specifier is **bare**, never a path into `dist`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkDiacriticFolds,
  collectFoldSources as walk,
  EXPLICIT_FOLD_KINDS,
  findDiacriticFolds,
  helperIsStillTheOwner,
  isScannablePath,
  ledgerFor,
  POPULATION_ROOTS,
  SHARED_FOLD_HELPER,
  type LedgerEntry,
  type ScannedFile,
} from '@endora-commerce/cli/rules/diacritic-folds.js';

import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/diacritic-folds.js';

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

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

  const result = checkDiacriticFolds(files, DIACRITIC_FOLDS_ALLOWED, SLUG_RUNS_ALLOWED);
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
