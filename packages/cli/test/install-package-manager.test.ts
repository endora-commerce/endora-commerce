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
 * One value: the CLI's own manifest declares `packageManager`, equal to the
 * repository root's — the pnpm this release was built and tested with. The
 * fallback runs exactly that through corepack, and the instance re-declares it
 * (`new-instance/host.ts` already copies the CLI's own `packageManager` into
 * the scaffold), so the CLI and the instance agree by construction.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { corepackRunnerFor, runInstall } from '../src/install/index.js';

const CLI_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = dirname(dirname(CLI_DIR));

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('the CLI pins the pnpm it falls back to', () => {
  const own = readJson(join(CLI_DIR, 'package.json'))['packageManager'];
  const root = readJson(join(REPO_ROOT, 'package.json'))['packageManager'];

  it("declares `packageManager`, equal to the repository root's", () => {
    expect(typeof root).toBe('string');
    expect(own, 'packages/cli/package.json declares no `packageManager`').toBe(root);
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
