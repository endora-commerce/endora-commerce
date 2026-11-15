/**
 * `scripts/setup-worktree.sh` verifies the worktree it wired, not the directory
 * it was invoked from (issue #1205).
 *
 * The documented invocation runs from the **main** checkout:
 *
 *   git worktree add ../wt-<slug> -b <branch> origin/master
 *   bash ../wt-<slug>/scripts/setup-worktree.sh
 *
 * The script installs into its own checkout (`$HERE`, derived from
 * `BASH_SOURCE`), but its last step ran the resolution guard with the caller's
 * working directory, and the guard locates the checkout it answers about from
 * `process.cwd()`. So the freshly installed worktree was never inspected: the
 * main checkout was, and whenever the main checkout's `node_modules` was behind
 * its own lockfile — `mod-forms` added on `master`, the main tree not yet
 * re-installed — the script exited 1 over a worktree whose links were all
 * present, while `tsx scripts/workspace-resolution.ts` run inside the worktree
 * passed. Invoked from inside the worktree, the same script exited 0, which is
 * why it looked intermittent.
 *
 * The proof runs the real script from a directory that is a checkout with a
 * genuinely missing link, with `pnpm` stubbed so the install and the CLI build
 * are no-ops: the guard is then the only thing that can decide the exit code.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  inspectWorkspaceResolution,
  nodeResolutionFs,
  workspaceResolutionRefusal,
} from '../../../../scripts/workspace-resolution.js';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const SCRIPT = join(REPO, 'scripts', 'setup-worktree.sh');
const TSX = join(REPO, 'backend', 'node_modules', '.bin', 'tsx');
const GUARD = join(REPO, 'scripts', 'workspace-resolution.ts');

let scratch = '';
/** A checkout of *some* workspace whose one declared link is not installed. */
let brokenCheckout = '';
/** A `PATH` whose `pnpm` succeeds without doing anything. */
let stubbedPath = '';

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'setup-worktree-'));

  brokenCheckout = join(scratch, 'main-checkout');
  mkdirSync(join(brokenCheckout, 'packages', 'forms'), { recursive: true });
  mkdirSync(join(brokenCheckout, 'packages', 'consumer'), { recursive: true });
  writeFileSync(join(brokenCheckout, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  writeJson(join(brokenCheckout, 'package.json'), { name: 'fixture-root', private: true });
  writeJson(join(brokenCheckout, 'packages', 'forms', 'package.json'), {
    name: '@endora-commerce/mod-forms',
  });
  writeJson(join(brokenCheckout, 'packages', 'consumer', 'package.json'), {
    name: '@endora-commerce/consumer',
    dependencies: { '@endora-commerce/mod-forms': 'workspace:*' },
  });

  const bin = join(scratch, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'pnpm'), '#!/usr/bin/env bash\nexit 0\n');
  chmodSync(join(bin, 'pnpm'), 0o755);
  stubbedPath = `${bin}${delimiter}${process.env['PATH'] ?? ''}`;
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('setup-worktree.sh', () => {
  it('starts from a checkout the guard passes and a fixture the guard refuses', () => {
    // Both halves of the premise, measured, so the next test cannot pass or
    // fail for a reason other than which directory the guard reads.
    const own = workspaceResolutionRefusal(inspectWorkspaceResolution(REPO, nodeResolutionFs()));
    expect(own).toBeNull();

    const direct = spawnSync(TSX, [GUARD], { cwd: brokenCheckout, encoding: 'utf8' });
    expect(direct.status).toBe(1);
    expect(direct.stderr).toContain('packages/consumer/node_modules/@endora-commerce/mod-forms');
    // The refusal names the checkout it inspected, so a report about the wrong
    // tree says which tree it was about.
    expect(direct.stderr).toContain(`not installed in this checkout (${brokenCheckout})`);
  });

  it('exits 0 when invoked from another checkout whose links are missing', () => {
    const run = spawnSync('bash', [SCRIPT], {
      cwd: brokenCheckout,
      encoding: 'utf8',
      env: { ...process.env, PATH: stubbedPath },
    });
    expect(run.stderr).not.toContain('are not installed');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('[workspace-resolution] read:');
  });
});
