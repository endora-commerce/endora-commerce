import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadOverlayModuleEntries,
  overlayModuleEntriesUnder,
} from '../../src/overlay/overlay-runtime.js';
import { MODULES } from '../../src/composition.generated.js';
import { FIXTURES } from './_fixtures.js';

/**
 * `loadOverlayModuleEntries` — the one composition path for an overlay module
 * (D-103), and the runtime discovery that replaced a generated artefact's
 * overlay branch (D-104).
 *
 * The crash this replaces was measured, not inferred: `loadOverlayModulePlugins`
 * imported `<id>/plugin.ts` for **every** discovered overlay id, with no
 * existence guard and no `try`, while `scanOverlay` short-circuits a new module
 * id before it inspects a single file. So a `backend.ts`-only overlay module —
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

describe('D-104 — discovery is per-deployment, at runtime, and empty for bare core', () => {
  it('finds the example deployment’s module with DEPLOYMENT selected', async () => {
    const entries = await loadOverlayModuleEntries({
      DEPLOYMENT: 'example',
    } as NodeJS.ProcessEnv);
    expect(entries.map((e) => e.id)).toEqual(['example_overlay']);
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
