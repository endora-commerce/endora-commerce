import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  listOverlayModuleDirs,
  resolveOverlayUnit,
} from '@endora-commerce/platform/overlay';
import type { ModuleManifest } from '@endora-commerce/contracts';
import {
  loadOverlayModuleEntries,
  overlayModuleEntriesUnder,
} from '../../src/overlay/overlay-runtime.js';
import { overlayModulesRootFor } from '../../src/overlay/overlay-roots.js';
import { MODULES } from '../../src/composition.generated.js';
import { FIXTURES } from './_fixtures.js';

/**
 * `loadOverlayModuleEntries` — the one composition path for an overlay module
 * (D-103), and the runtime discovery that replaced a generated artefact's
 * overlay branch (D-104).
 *
 * The crash this replaces was measured, not inferred: `loadOverlayModulePlugins`
 * imported `<id>/plugin.ts` for **every** discovered overlay id, with no
 * existence guard and no `try`, while the overlay scan reports a module
 * directory without inspecting a single file inside it. So a `backend.ts`-only
 * overlay module —
 * the path the generated composer explicitly ordered last, with a header
 * explaining why — could not boot at all. The first case below is that shape.
 */

const ENTRIES_ROOT = join(FIXTURES, 'overlay-entries');
// A root of its own: a refusal fixture sharing a root with the others would
// abort the whole scan and every case under it would be measuring this throw.
const NO_REGISTER_ROOT = join(FIXTURES, 'overlay-entries-no-register');

describe('D-103 — a backend.ts-only overlay module composes, and a directory without one is skipped', () => {
  it('returns an entry for a module shipping backend.ts and no plugin.ts', async () => {
    const entries = await overlayModuleEntriesUnder(ENTRIES_ROOT);
    const composed = entries.find((e) => e.id === 'fixture_composed');

    expect(composed).toBeDefined();
    expect(typeof composed?.registerModule).toBe('function');
    // The version comes off the manifest, so a composed entry cannot claim one
    // its manifest does not declare.
    expect(composed?.version).toBe('2.3.4');
  });

  it('skips a module directory with no backend.ts instead of throwing', async () => {
    // The exact shape that crashed composition before D-103. `plugin.ts` is
    // gone, so there is nothing to guard the import of; what remains is that a
    // directory the deployment ships for another reason must not stop the boot.
    const entries = await overlayModuleEntriesUnder(ENTRIES_ROOT);
    expect(entries.map((e) => e.id)).not.toContain('fixture_manifest_only');
  });

  it('refuses a backend.ts that exports no registerModule, rather than skipping it', async () => {
    // Skipping composes nothing, and the first symptom is a 404 in a suite
    // nobody connects to this loader.
    await expect(overlayModuleEntriesUnder(NO_REGISTER_ROOT)).rejects.toThrow(
      /fixture_no_register[\s\S]*registerModule/,
    );
  });
});

/**
 * The overlay module ids the `example` deployment **ships**, derived twice over.
 *
 * It exists because the assertion below used to be the literal
 * `['example_overlay']`, and `specs/130-comarch-xl-sync/` took `master` red by
 * adding two overlay modules without editing it. That is `AGENTS.md`'s ledger
 * trap exactly: a statement derived *about* the files a change touches is not a
 * file that change touches, so the batch that adds an overlay module is
 * structurally the batch that cannot see this go stale — and
 * `test:backend:deployment` does not run on a merge-request pipeline, so nothing
 * caught it before the merge. It had already been fixed **once** on the same
 * branch, for the *count* in `test/unit/_lifecycle/registered-manifests.test.ts`;
 * this is the second instance the author and the reviewer each walked past.
 *
 * A derived expectation risks being vacuous — passing over whatever the tree
 * happens to hold — so it is derived from authorities the loader does not use
 * for the thing being asserted:
 *
 *   - the **population** is `listOverlayModuleDirs` filtered by the same
 *     `resolveOverlayUnit(dir, 'backend')` D-103 skips on, so a module the scan
 *     drops and a directory it invents both red, and a `manifest.ts`-only
 *     directory does **not** red (that skip is asserted over a fixture above,
 *     where it belongs);
 *   - the **id** is each module's own `manifest.id`, which the loader never
 *     reads — it takes the id from the *directory*, because that is what makes
 *     `overlay: true` safe (D-104). So a directory whose manifest declares
 *     another id reds here, which the old literal could not see either.
 *
 * The caller adds the one anchor a derivation cannot supply: that
 * `example_overlay` — the deployment's own documented module, named by every
 * other case in this file — is among them.
 */
async function shippedExampleOverlayIds(): Promise<string[]> {
  const root = overlayModulesRootFor('example');
  const ids: string[] = [];
  for (const dir of listOverlayModuleDirs(root)) {
    const moduleDir = join(root, dir);
    if (resolveOverlayUnit(moduleDir, 'backend') === null) continue;
    const manifestPath = resolveOverlayUnit(moduleDir, 'manifest');
    expect(manifestPath, `${moduleDir} ships a backend entry point and no manifest`).not.toBeNull();
    const mod = (await import(pathToFileURL(manifestPath as string).href)) as {
      manifest?: ModuleManifest;
    };
    expect(mod.manifest, `${manifestPath} exports no manifest`).toBeDefined();
    ids.push((mod.manifest as ModuleManifest).id);
  }
  return ids.sort();
}

describe('D-104 — discovery is per-deployment, at runtime, and empty for bare core', () => {
  it('finds every module the example deployment ships, with DEPLOYMENT selected', async () => {
    const entries = await loadOverlayModuleEntries({
      DEPLOYMENT: 'example',
    } as NodeJS.ProcessEnv);
    const shipped = await shippedExampleOverlayIds();
    // Never a literal — see `shippedExampleOverlayIds`. The two assertions the
    // derivation cannot make itself: it found something at all, and it found
    // the deployment's own documented module.
    expect(shipped).not.toHaveLength(0);
    expect(shipped).toContain('example_overlay');
    expect(entries.map((e) => e.id).sort()).toEqual(shipped);
  });

  it('finds nothing for a bare-core build or an unknown deployment', async () => {
    expect(await loadOverlayModuleEntries({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      await loadOverlayModuleEntries({ DEPLOYMENT: 'no-such-deployment' } as NodeJS.ProcessEnv),
    ).toEqual([]);
  });

  it('never puts a deployment’s module into the shared core list (FR-004/FR-008)', () => {
    // The committed composer is bare core under every value of `DEPLOYMENT`
    // since D-104; before it, generating with the variable set wrote a
    // deployment's import into a file every other deployment ships.
    expect(MODULES.map((m) => m.id)).not.toContain('example_overlay');
  });
});

describe('D-104 — `overlay` is derived from the root, never claimed by the module', () => {
  /**
   * `ModuleEntry.overlay` exempts a module from the rule that it may decorate
   * only what it registered. That is the highest-privilege bit in the composer,
   * so where it comes from is the whole of its safety: a location the loader
   * found the module under, never a field a module writes about itself.
   *
   * Asserted through the loader rather than over a hand-built entry, because a
   * literal would test the exemption while skipping the derivation — which is
   * half of what makes the exemption safe (issue #130).
   */
  it('stamps overlay: true on every entry it discovers under a deployment root', async () => {
    const entries = await loadOverlayModuleEntries({
      DEPLOYMENT: 'example',
    } as NodeJS.ProcessEnv);
    expect(entries).not.toHaveLength(0);
    for (const entry of entries) expect(entry.overlay).toBe(true);
  });

  it('leaves every core entry unmarked, so core cannot claim the exemption', () => {
    for (const entry of MODULES) expect(entry.overlay).toBeUndefined();
  });
});
