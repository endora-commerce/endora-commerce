import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHECKOUT_MARKER,
  isInsideNestedCheckout,
  nestedCheckoutRoots,
} from '../../../scripts/lib/nested-checkouts.js';

/**
 * "Is this path part of *this* checkout?" — the TypeScript half.
 *
 * Every case enters at the **top** of the derivation, over a directory tree on
 * disk (issue #130): the thing being proved is which directories the walk
 * descends into and which it refuses, and a fixture handed a pre-computed list
 * of roots would prove nothing about that.
 *
 * The shell twin's cases live in `shell-checks.test.ts` — `resolves the outer
 * root when a work tree is nested inside the checkout`, `prunes a nested clone
 * too, not only the gitfile a work tree carries`, `judges the outer tree rather
 * than the nested one`. These are the same four questions asked of the same
 * discriminator in the other language.
 */

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A checkout, with the marker a checkout carries.
 *
 * The outer marker is not decoration. A rule that pruned any directory holding
 * a `.git` would prune the repository root itself and answer "no source here",
 * which is the vacuous pass in its purest form — so the fixture makes the walk
 * step over its own marker on every case below.
 */
function makeCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'endora-nested-checkouts-'));
  fixtures.push(root);
  mkdirSync(join(root, CHECKOUT_MARKER), { recursive: true });
  writeFileSync(join(root, CHECKOUT_MARKER, 'HEAD'), 'ref: refs/heads/master\n', 'utf8');
  return root;
}

function write(root: string, path: string, content = 'export const a = 1;\n'): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

/** The gitfile `git worktree add` leaves behind. */
function nestWorktree(root: string, path: string): void {
  write(root, `${path}/${CHECKOUT_MARKER}`, `gitdir: ${join(root, '.git', 'worktrees', 'x')}\n`);
}

/** The `.git` directory a clone or a submodule leaves behind. */
function nestClone(root: string, path: string): void {
  mkdirSync(join(root, path, CHECKOUT_MARKER), { recursive: true });
  writeFileSync(join(root, path, CHECKOUT_MARKER, 'HEAD'), 'ref: refs/heads/master\n', 'utf8');
}

describe('nestedCheckoutRoots — which directories are somebody else’s checkout', () => {
  it('finds a work tree nested under the repository directory', () => {
    // The shape this exists for: agents here work in `git worktree`s created
    // under the repository directory, so a repo-wide walk reads one copy of the
    // whole tree per worktree.
    const root = makeCheckout();
    write(root, 'packages/modules/blog/package.json', '{ "name": "blog" }\n');
    nestWorktree(root, '.claude/worktrees/agent-x');
    write(root, '.claude/worktrees/agent-x/packages/modules/blog/package.json', '{}\n');

    expect(nestedCheckoutRoots(root)).toEqual(['.claude/worktrees/agent-x']);
  });

  it('finds a nested clone too, not only the gitfile a work tree carries', () => {
    // The two markers git writes for the same fact. A rule that saw one of them
    // would prune half the nested checkouts and go on reading the rest, which is
    // the same wrong answer with a smaller number.
    const root = makeCheckout();
    nestClone(root, 'vendor/fork');

    expect(nestedCheckoutRoots(root)).toEqual(['vendor/fork']);
  });

  it('finds one wherever it is, because the rule is not keyed on a path name', () => {
    // D-100: `.claude/worktrees` is a derived fact, and writing it down would
    // answer wrongly for the first checkout somebody parks somewhere else.
    const root = makeCheckout();
    nestWorktree(root, 'scratch/review-copy');
    nestClone(root, 'vendor/fork');
    nestWorktree(root, '.claude/worktrees/agent-x');

    expect(nestedCheckoutRoots(root)).toEqual([
      '.claude/worktrees/agent-x',
      'scratch/review-copy',
      'vendor/fork',
    ]);
  });

  it('steps over the checkout’s own marker rather than pruning the repository', () => {
    // The direction that would be catastrophic and silent: pruning the root
    // makes every caller's population empty, and an empty population is exactly
    // what a two-way accounting sweep reports as clean.
    const root = makeCheckout();
    write(root, 'packages/modules/blog/package.json', '{ "name": "blog" }\n');

    expect(nestedCheckoutRoots(root)).toEqual([]);
  });

  it('does not descend into a nested checkout to find the checkouts inside it', () => {
    // A worktree of this repository holds worktrees of its own on a working
    // machine. Reporting them would be reporting a path relative to the wrong
    // root, and walking them costs the whole tree again per level.
    const root = makeCheckout();
    nestWorktree(root, '.claude/worktrees/agent-x');
    nestWorktree(root, '.claude/worktrees/agent-x/.claude/worktrees/agent-y');

    expect(nestedCheckoutRoots(root)).toEqual(['.claude/worktrees/agent-x']);
  });

  it('does not walk into an installed dependency looking for one', () => {
    // `node_modules` holds packages that ship their own `.git` in some
    // registries, and it is not this repository's source either way. Pruned in
    // step with the shell twin's `MODULE_ROOT_PRUNED_DIRECTORIES`.
    const root = makeCheckout();
    nestClone(root, 'node_modules/some-package');

    expect(nestedCheckoutRoots(root)).toEqual([]);
  });
});

describe('isInsideNestedCheckout — the pure half', () => {
  const roots = ['.claude/worktrees/agent-x', 'vendor/fork'] as const;

  it('matches the root itself and everything under it', () => {
    expect(isInsideNestedCheckout('.claude/worktrees/agent-x', roots)).toBe(true);
    expect(
      isInsideNestedCheckout('.claude/worktrees/agent-x/backend/src/index.ts', roots),
    ).toBe(true);
  });

  it('does not match a sibling whose name merely starts the same way', () => {
    // The trailing separator is the whole of this: `vendor/fork` must not
    // swallow `vendor/fork-of-ours`, which is this repository's own source.
    expect(isInsideNestedCheckout('vendor/fork-of-ours/src/index.ts', roots)).toBe(false);
    expect(isInsideNestedCheckout('.claude/agents/endora-commerce-dev.md', roots)).toBe(false);
  });

  it('leaves this checkout’s own paths alone', () => {
    expect(isInsideNestedCheckout('backend/src/modules/orders/manifest.ts', roots)).toBe(false);
  });

  it('is inert when nothing is nested, so a clean checkout pays nothing', () => {
    expect(isInsideNestedCheckout('backend/src/index.ts', [])).toBe(false);
  });
});
