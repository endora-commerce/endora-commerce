/**
 * "Is this path part of *this* checkout?" — one derivation for the TypeScript
 * half of the estate (D-168 follow-up; the same question `scripts/lib/module-root.sh`
 * answers for the shell half).
 *
 * ## The problem it exists for
 *
 * Agents in this project work in `git worktree`s created **under** the
 * repository directory, and each one is a complete copy of the tree. So any
 * walk rooted at the repository — as opposed to one bounded by the workspace
 * globs or by a named source directory — finds every file of this repository
 * once per worktree, plus its own. Fifty-one of them stood on the machine this
 * was written for.
 *
 * Every consequence of that is a wrong answer about *this* commit. A rule that
 * counts finds a population that swells with housekeeping nobody performed
 * deliberately. A rule that reconciles a scan against a declaration finds
 * entries it cannot account for and reports them as defects, when what it has
 * actually done is read another branch's tree and file the verdict under ours.
 * That is what happened to the D-168 module-package guard an hour after it
 * merged: red on every developer machine, green in CI, and CI right only
 * because it has no nested worktrees.
 *
 * ## The discriminator is the `.git` entry, not a path name
 *
 * `scripts/lib/module-root.sh` ruled this and the ruling holds here unchanged;
 * its header carries the long form. In brief: a rule keyed on
 * `.claude/worktrees` would be a derived fact written down (D-100) and would
 * miss the first worktree somebody puts elsewhere — a nested clone under
 * `vendor/`, a submodule, a second checkout parked wherever it was convenient.
 * `git worktree list --porcelain` was the alternative and was rejected there for
 * three reasons that apply here too: the walk sees *files*, and the `.git`
 * marker travels with them while git's registry can disagree with the
 * filesystem in both directions; the registry knows only worktrees, so a nested
 * clone or a submodule would still be walked; and it needs `git` on `PATH`.
 *
 * Both markers git writes count, because both occur here: `git worktree add`
 * leaves a `.git` **file** (a gitfile naming the administrative directory), and
 * a clone or a submodule leaves a `.git` **directory**. A rule that saw one of
 * them would prune half the nested checkouts on this machine and go on reading
 * the rest.
 *
 * **What it cannot see**, stated rather than discovered later: a checkout whose
 * marker is somewhere else — `GIT_DIR` in the environment, a
 * `--separate-git-dir` whose gitfile has been removed, a tree exported without
 * its `.git` — reads as ordinary source and is walked. That is the direction to
 * be wrong in: such a tree is indistinguishable from a copied directory, and
 * walking it costs reads rather than coverage.
 *
 * ## Two functions, because the two halves are different kinds of question
 *
 * {@link nestedCheckoutRoots} asks the filesystem and answers with a list of
 * repo-relative roots. {@link isInsideNestedCheckout} is a **pure predicate**
 * over that list. The shell twin is split the same way
 * (`module_root_scan_nested_checkouts` / `module_root_drop_nested_checkouts`),
 * and the split is what lets a caller whose own exclusion rule must stay
 * decidable from a synthetic path — `check-nul-bytes`' `isScannablePath` is the
 * standing example — take the roots once at the top of its run and keep its
 * predicate pure.
 *
 * ## Why there are still two implementations, and which third is retiring
 *
 * `scripts/lib/module-root.sh` is **not** merged into this file and cannot be:
 * `quality:static` runs with bash, grep, perl and POSIX awk and no `pnpm
 * install`, so a shell check cannot call a TypeScript library. The two are a
 * deliberate twin pair, as `lib/read-size.sh` and `lib/read-size.ts` are, and
 * the ruling they implement is written once — in the shell file's header, which
 * this one cites rather than restates.
 *
 * `check-nul-bytes.ts` is the third answer and it should become a caller of
 * this one. Its `SKIPPED_PATH_PREFIXES` names `.claude/worktrees` as a literal,
 * which is the derived fact D-100 refuses and which misses a nested clone or a
 * worktree parked anywhere else. The reason its own comment gives — that
 * `.claude/` holds tracked source, so the exclusion cannot be name-anchored —
 * argues against `SKIPPED_DIRECTORIES` and not against this discriminator. What
 * it does have is a real constraint: `isScannablePath` is deliberately decidable
 * from a synthetic path, so that the walk's prune and the rule's exclusion are
 * one function and its red proofs can enter at the top. That is why this file
 * splits into a filesystem half and a pure half — the conversion is to resolve
 * the roots once in `main()` and pass them into the predicate, so the predicate
 * stays pure and the literal becomes derived. It is not done here, because the
 * conversion re-measures a green check's read size and its inventory entry, and
 * a bug fix is the wrong place to move a passing check's population.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { PRUNED_DIRECTORIES } from './module-roots.js';

/**
 * The entry whose presence makes a directory the root of a checkout.
 *
 * A constant rather than a literal in three places, because the whole rule
 * rests on this one name and a reader has to be able to find every use of it.
 */
export const CHECKOUT_MARKER = '.git';

/** How deep {@link nestedCheckoutRoots} descends before giving up. */
const MAX_DEPTH = 12;

function isDirectory(path: string): boolean {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat !== undefined && stat.isDirectory();
}

function exists(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false }) !== undefined;
}

/**
 * The root of every checkout nested inside `repoRoot`, repo-relative, sorted.
 *
 * The checkout's **own** marker is stepped over by name: the walk starts at the
 * repository root, so the marker there says nothing about a nested tree. A rule
 * that pruned any directory carrying a `.git` would prune the repository and
 * answer "nothing here", which is the vacuous pass in its purest form — the
 * fixture in `test/unit/scripts/nested-checkouts.test.ts` carries an outer
 * marker for exactly that reason.
 *
 * The walk does not descend into a nested checkout: everything under it belongs
 * to that checkout, and a worktree of this repository holds a full copy of
 * `node_modules`-free source that would otherwise be walked in its entirety.
 */
export function nestedCheckoutRoots(repoRoot: string): readonly string[] {
  const roots: string[] = [];

  const visit = (directory: string, relative: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PRUNED_DIRECTORIES.includes(entry)) continue;
      const full = join(directory, entry);
      if (!isDirectory(full)) continue;
      const key = relative === '' ? entry : `${relative}/${entry}`;
      if (exists(join(full, CHECKOUT_MARKER))) {
        roots.push(key);
        continue;
      }
      visit(full, key, depth + 1);
    }
  };

  visit(repoRoot, '', 0);
  return roots.sort();
}

/**
 * Whether a repo-relative path names a nested checkout or something inside one.
 *
 * The roots are literal paths, so the comparison is a literal prefix test with
 * the separator appended — that is what makes `vendor/fork` not match
 * `vendor/fork-of-ours`, and it is why the shell twin uses `index(…) == 1`
 * rather than a regex built from a path holding unescaped dots. The root itself
 * matches: a listing that names the directory is naming another checkout.
 */
export function isInsideNestedCheckout(
  relativePath: string,
  roots: readonly string[],
): boolean {
  const path = relativePath.split('\\').join('/');
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}
