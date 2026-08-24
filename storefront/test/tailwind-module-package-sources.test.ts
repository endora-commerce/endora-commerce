/**
 * The storefront build reads a module package's sources (feature 080, T044).
 *
 * The admin's twin (`admin/test/unit/tailwind-module-package-sources.test.ts`)
 * exists because Vite and Next resolve and scan differently and the answer had
 * to be established for each. It turned out to be the same answer: Tailwind v4's
 * automatic detection roots at the tool's base, which for `@tailwindcss/postcss`
 * is `process.cwd()` — this workspace member. Measured before the repair, a
 * `.tsx` at `storefront/` reaches the built `.next/static/css`, one at the
 * repository root does not, and one under `packages/modules/blog/src` does not.
 * The `@source` directive in `app/globals.css` is the repair.
 *
 * The compile below is the storefront's own plugin over its own stylesheet, with
 * `from` set to the file Next passes — which is what fixes the base a `@source`
 * is resolved against. Running `next build` instead would be the same answer for
 * ninety times the cost; running Tailwind's internals directly would be a third
 * toolchain that neither app uses.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

import {
  planTailwindSourceProbes,
  readTailwindSourceVerdicts,
  removeTailwindSourceProbes,
  writeTailwindSourceProbes,
} from '../../scripts/tailwind-source-scan.js';

const storefrontRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(storefrontRoot, '..');

/** `app/globals.css`, compiled by the plugin `postcss.config.mjs` declares. */
async function compileStorefrontStylesheet(): Promise<string> {
  const from = path.join(storefrontRoot, 'app/globals.css');
  const source = await readFile(from, 'utf8');
  const result = await postcss([tailwindcss()]).process(source, { from });
  return result.css;
}

describe('storefront Tailwind sources reach module packages', () => {
  it('emits a utility that only a module package declares, and none from outside its sources', async () => {
    const probes = planTailwindSourceProbes(repoRoot);
    expect(probes.filter((probe) => probe.expected).length).toBeGreaterThan(0);
    expect(probes.filter((probe) => !probe.expected).length).toBe(1);

    writeTailwindSourceProbes(probes);
    try {
      const css = await compileStorefrontStylesheet();
      expect(css.length).toBeGreaterThan(0);
      const { actual, expected } = readTailwindSourceVerdicts(probes, css);
      expect(actual).toEqual(expected);
    } finally {
      removeTailwindSourceProbes(probes);
    }
  }, 120_000);
});
