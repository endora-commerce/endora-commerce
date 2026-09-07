/**
 * The admin build reads the sources of every package it composes (feature 080
 * T044; feature 110 T125,
 * `specs/110-instance-repository/contracts/admin-stylesheet-composition.md`).
 *
 * Tailwind v4's **automatic** source detection roots at the build tool's own
 * base directory, which for `@tailwindcss/vite` is `config.root` — this
 * workspace member. Measured on this tree before the repair: a `.tsx` at
 * `admin/` is scanned, one at `packages/modules/blog/src` is not, and the class
 * it declares is simply missing from `dist/assets/*.css`. No error, no warning,
 * an unstyled component in production. That is the class of defect this file
 * exists for.
 *
 * **The repair it guards changed, and so did the population.** It was one
 * `@source "../../packages/**"` in `src/index.css`, correct here and unusable in
 * a client's instance, where the shell and every module are installed under
 * `node_modules`. Each package now declares its own `@source` lines at its
 * `./tailwind.css` subpath and `src/tailwind.generated.css` enumerates them, so
 * what is asserted is what R2.2 names: every package that declares sources — the
 * 55 module admin layers *and* the shell and kit family, which the old
 * population could not see at all — at every directory it declares, `dist`
 * included. `dist` is what a published tarball ships and is what an instance
 * scans, and §1.1 measures it as the *more* accurate population rather than a
 * compromise: it excludes tests, and a comment or an identifier a source scan
 * mistakes for a class is compiled away.
 *
 * The compile is the app's **own** toolchain — Vite, with `vite.config.ts` and
 * therefore `@tailwindcss/vite` — driven over the stylesheet alone in a child
 * process (see `test/helpers/compile-stylesheet.mjs` for why a child process).
 * It is deliberately not a re-implementation of Tailwind's glob semantics: a
 * matcher of ours could agree with itself while disagreeing with the build, and
 * the build is what drops the class.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  declaredSourceProbeTargets,
  planTailwindSourceProbes,
  readTailwindSourceVerdicts,
  removeTailwindSourceProbes,
  writeTailwindSourceProbes,
} from '../../../scripts/tailwind-source-scan.js';

const execFileAsync = promisify(execFile);

const adminRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(adminRoot, '..');

/** The admin stylesheet, compiled by Vite exactly as `pnpm --filter admin run build` does. */
async function compileAdminStylesheet(): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(adminRoot, 'test/helpers/compile-stylesheet.mjs')],
    { cwd: adminRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

describe('admin Tailwind sources reach every package it composes', () => {
  it('emits a utility that only a composed package declares, and none from outside its sources', async () => {
    // R2.2's population, from the generator's own derivation: probing a set of
    // our own would be a second answer to *"which directories does this package
    // ask the host to scan"*, and it would fail invisibly in both directions.
    const probes = planTailwindSourceProbes(
      repoRoot,
      process.pid,
      declaredSourceProbeTargets(repoRoot),
    );
    expect(probes.filter((probe) => probe.expected).length).toBeGreaterThan(0);
    // The control stays. Without it the assertion is satisfied by a build that
    // emits everything, and the guard agrees with itself.
    expect(probes.filter((probe) => !probe.expected).length).toBe(1);
    // Both halves of every declaration are probed, and the emitted half is what
    // a client installs: a run over source alone would pass while saying
    // nothing about the tarball.
    expect(probes.some((probe) => probe.file.includes('/dist/'))).toBe(true);

    writeTailwindSourceProbes(probes);
    try {
      const css = await compileAdminStylesheet();
      expect(css.length).toBeGreaterThan(0);
      const { actual, expected } = readTailwindSourceVerdicts(probes, css);
      expect(actual).toEqual(expected);
    } finally {
      removeTailwindSourceProbes(probes);
    }
  }, 120_000);
});
