/**
 * The `pnpm` `endora install` runs when none is on `PATH` (FR-158), and the
 * `packageManager` the instance it writes declares.
 *
 * ## The defect this pins
 *
 * `0.100.0` fell back to `corepack pnpm@latest`. On the day of the W5.5 public
 * acceptance run (GitHub run 36835214331) `latest` was pnpm 12.8.1, which ships
 * `bin/pnpm.mjs` and a native binary, while the corepack Node 22.18 bundles
 * (0.33.0) can only start `bin/pnpm.cjs`. Every stranger without pnpm on
 * `PATH` — a hosted runner included — died with `Cannot find module
 * '…/pnpm/12.8.1/bin/pnpm.cjs'` before anything was installed. `latest` is a
 * value that moves without this repository, so the fallback was a fact about
 * the calendar rather than about the release.
 *
 * ## The rule
 *
 * One value: the repository root's `packageManager` — the pnpm this release
 * was built and tested with — copied by the CLI's build into
 * `dist/release-index.json`. The fallback runs exactly that through corepack,
 * and `new instance` writes the same value into the scaffold, so the CLI and
 * the instance agree by construction.
 *
 * Not the CLI's own `package.json`: the first version of this fix declared it
 * there, and the packed `0.100.1` tarball came out without it — `pnpm pack`
 * strips `packageManager` from a published manifest — so a stranger would have
 * had no pin at all.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { corepackRunnerFor, pnpmShimEnvironment, runInstall } from '../src/install/index.js';
import { ownPackageManager, parseReleaseIndex, RELEASE_INDEX_FILE } from '../src/lib/release-index.js';
import { resolveInstanceHost } from '../src/new-instance/host.js';

const CLI_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(CLI_DIR));

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('the CLI pins the pnpm it falls back to', () => {
  const root = readJson(join(REPO_ROOT, 'package.json'))['packageManager'];
  const own = ownPackageManager();

  it("the build records the repository root's `packageManager` in the release index", () => {
    expect(typeof root).toBe('string');
    const built = join(CLI_DIR, 'dist', RELEASE_INDEX_FILE);
    expect(parseReleaseIndex(readFileSync(built, 'utf8'), built).packageManager).toBe(root);
    expect(own).toBe(root);
  });

  it('`new instance` takes the same value for the scaffold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'endora-pm-'));
    try {
      const platform = join(dir, 'node_modules', '@endora-commerce', 'platform');
      mkdirSync(platform, { recursive: true });
      writeFileSync(
        join(platform, 'package.json'),
        JSON.stringify({ name: '@endora-commerce/platform', version: '0.100.1' }),
      );
      const host = resolveInstanceHost({ cwd: dir, targetDir: join(dir, 'acme-shop') });
      expect(host.packageManager).toBe(root);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pins an exact pnpm whose major the supported Node’s corepack can start', () => {
    const match = /^pnpm@(\d+)\.\d+\.\d+$/.exec(String(own));
    expect(match, `\`${String(own)}\` is not an exact \`pnpm@<x.y.z>\``).not.toBeNull();
    // pnpm 11 onwards ships `bin/pnpm.mjs`; corepack 0.33.0 (Node 22.18's)
    // resolves `bin/pnpm.cjs` and nothing else. Moving past 10 needs a Node
    // floor whose corepack starts the new layout — measure it first.
    expect(Number(match![1])).toBeLessThanOrEqual(10);
  });

  it('runs exactly the pinned version through corepack', () => {
    expect(corepackRunnerFor('pnpm@9.15.0')).toEqual({
      command: 'corepack',
      prefix: ['pnpm@9.15.0'],
      label: 'corepack pnpm@9.15.0',
    });
    // A corepack hash suffix is the manifest's business, not the command line's.
    expect(corepackRunnerFor('pnpm@9.15.0+sha512.abc')?.prefix).toEqual(['pnpm@9.15.0']);
  });

  it('never invents a version: a missing, ranged or tagged pin offers no corepack runner', () => {
    for (const value of [undefined, '', 'pnpm', 'pnpm@latest', 'pnpm@10', 'npm@10.9.0', 42]) {
      expect(corepackRunnerFor(value), String(value)).toBeNull();
    }
  });

  it('the refusal names the pinned command, and never `@latest`', async () => {
    const error = await runInstall({
      dir: join(REPO_ROOT, 'does-not-matter-acme'),
      cwd: REPO_ROOT,
      storefront: false,
      services: false,
      packageManagers: [],
    } as Parameters<typeof runInstall>[0]).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    const message = (error as Error).message;
    expect(message).toContain(`corepack ${String(own)}`);
    expect(message).not.toContain('@latest');
  });

  it('no source under `src/` names `pnpm@latest`', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.[cm]?ts$/.test(entry) && readFileSync(path, 'utf8').includes('pnpm@latest')) {
          offenders.push(path);
        }
      }
    };
    walk(join(CLI_DIR, 'src'));
    expect(offenders).toEqual([]);
  });
});

/**
 * A `pnpm` the pipeline's own children can call.
 *
 * The instance's scripts chain `pnpm run …` (`setup` is four of them), and a
 * script's shell finds `pnpm` on `PATH` or not at all — `corepack pnpm@x run
 * setup` puts nothing there. Measured on `0.100.1`'s first container run, once
 * the `latest` crash no longer hid it: `[3/5] corepack pnpm@9.15.0 run setup` →
 * `sh: 1: pnpm: not found`. So when the run reaches pnpm through corepack, its
 * children get a `pnpm` shim in a directory this run creates and owns, first on
 * their `PATH` — never `corepack enable`, which writes into Node's directory.
 */
describe('the children of a corepack-run pipeline find `pnpm`', () => {
  it('a `pnpm` on PATH leaves the environment as it is', () => {
    const base = { PATH: '/usr/bin:/bin' };
    expect(pnpmShimEnvironment({ command: 'pnpm', prefix: [], label: 'pnpm' }, base)).toBe(base);
  });

  it('corepack: `pnpm` in a child shell runs `corepack <the pinned pnpm>` with its arguments', () => {
    const fake = mkdtempSync(join(tmpdir(), 'endora-fake-corepack-'));
    try {
      // A `corepack` that only says what it was asked, so the test needs neither
      // corepack nor a network.
      writeFileSync(join(fake, 'corepack'), '#!/bin/sh\necho "corepack $*"\n', { mode: 0o755 });
      const env = pnpmShimEnvironment(corepackRunnerFor('pnpm@9.15.0')!, {
        ...process.env,
        PATH: `${fake}${delimiter}/usr/bin${delimiter}/bin`,
      });
      const result = spawnSync('sh', ['-c', 'pnpm run generate && pnpm -C backend run migrate'], {
        env,
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().split('\n')).toEqual([
        'corepack pnpm@9.15.0 run generate',
        'corepack pnpm@9.15.0 -C backend run migrate',
      ]);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});
