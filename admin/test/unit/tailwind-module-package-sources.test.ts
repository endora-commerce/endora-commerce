/**
 * The admin build reads a module package's sources (feature 080, T044).
 *
 * Tailwind v4's **automatic** source detection roots at the build tool's own
 * base directory, which for `@tailwindcss/vite` is `config.root` — this
 * workspace member. Measured on this tree before the repair: a `.tsx` at
 * `admin/` is scanned, one at `packages/modules/blog/src` is not, and the class
 * it declares is simply missing from `dist/assets/*.css`. No error, no warning,
 * an unstyled component in production. That is the class of defect this file
 * exists for; the `@source` directive in `src/index.css` is the repair.
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

describe('admin Tailwind sources reach module packages', () => {
  it('emits a utility that only a module package declares, and none from outside its sources', async () => {
    const probes = planTailwindSourceProbes(repoRoot);
    expect(probes.filter((probe) => probe.expected).length).toBeGreaterThan(0);
    expect(probes.filter((probe) => !probe.expected).length).toBe(1);

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
