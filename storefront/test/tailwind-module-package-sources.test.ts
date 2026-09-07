/**
 * The storefront build reads the sources of every Endora package it composes
 * (feature 080 T044; feature 110 T127,
 * `specs/110-instance-repository/contracts/admin-stylesheet-composition.md` R5).
 *
 * Tailwind v4's **automatic** source detection roots at the build tool's own
 * base directory, which for `@tailwindcss/postcss` is `process.cwd()` — this
 * workspace member. Measured on this tree before the repair: a `.tsx` at
 * `storefront/` reaches the built `.next/static/css`, one at the repository root
 * does not, and one inside a package does not, and the class it declares is
 * simply missing. No error, no warning, an unstyled block in production.
 *
 * **The repair it guards changed, and so did the population.** It was one
 * `@source '../../packages/**'` in `app/globals.css`, and that line was correct
 * in this repository and unusable in a client's: under D-195 a client's
 * storefront is scaffolded into their **own** repository, where there is no
 * `packages/` above that file. `app/globals.css` now imports the one package
 * that ships scannable UI by name, and that package declares its own `@source`
 * lines at its `./tailwind.css` subpath — resolved relative to *that* file, so
 * they hold wherever it is installed.
 *
 * ## Why the storefront's population is derived differently from the admin's
 *
 * The admin reads a generated enumeration, because an instance's admin composes
 * a module set that varies per client. A storefront composes **no module package
 * at all**, so R5.2 gives it a static import and no generated artefact — which
 * means this file is the only place the two authors of that import can be
 * reconciled, and {@link importedSourceProbeTargets} reconciles them **both
 * ways**: the specifiers the stylesheet writes, against the dependencies the
 * manifest declares whose packages publish that subpath. A dependency that ships
 * UI and is imported by nobody is the silent failure one package at a time; an
 * import naming a package this member does not depend on resolves to nothing in
 * a scaffolded tree.
 *
 * `@endora-commerce/cms-components` is the case that makes the derivation worth
 * having rather than a list: it is a dependency, it ships UI, and it must
 * **not** be scanned — it publishes a finished, `cmsc:`-prefixed stylesheet at
 * `./styles.css` and takes none of this host's tokens (R4.2/R4.4). It falls out
 * of the population because it declares no `./tailwind.css`, which is a fact
 * about the package and not a name written down here.
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
  importedSourceProbeTargets,
  planTailwindSourceProbes,
  readTailwindSourceVerdicts,
  removeTailwindSourceProbes,
  writeTailwindSourceProbes,
} from '../../scripts/tailwind-source-scan.js';

const storefrontRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(storefrontRoot, '..');
const stylesheet = path.join(storefrontRoot, 'app/globals.css');

/** `app/globals.css`, compiled by the plugin `postcss.config.mjs` declares. */
async function compileStorefrontStylesheet(): Promise<string> {
  const source = await readFile(stylesheet, 'utf8');
  const result = await postcss([tailwindcss()]).process(source, { from: stylesheet });
  return result.css;
}

describe('storefront Tailwind sources reach the packages it composes', () => {
  it('emits a utility that only a composed package declares, and none from outside its sources', async () => {
    // The population is the stylesheet's own imports, reconciled against this
    // member's dependencies. Deriving it here instead would be a second answer
    // to "which packages does this storefront ask to be scanned", and it would
    // fail in the invisible direction: a guard probing a package nothing imports
    // reports a defect that is not there, and one that misses an imported
    // package reports a pass over a package nothing scans.
    const probes = planTailwindSourceProbes(
      repoRoot,
      process.pid,
      importedSourceProbeTargets(repoRoot, storefrontRoot, stylesheet),
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
      const css = await compileStorefrontStylesheet();
      expect(css.length).toBeGreaterThan(0);
      const { actual, expected } = readTailwindSourceVerdicts(probes, css);
      expect(actual).toEqual(expected);
    } finally {
      removeTailwindSourceProbes(probes);
    }
  }, 120_000);
});
