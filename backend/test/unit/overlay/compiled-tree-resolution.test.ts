import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  overlayModuleEntriesUnder,
  overlayModuleManifestsUnder,
} from '../../../src/overlay/overlay-runtime.js';
import { discoverManifests } from '../../../src/lifecycle/services/manifest-loader.js';
import { FIXTURES } from '../../overlay/_fixtures.js';

/**
 * D-165 step C — the overlay loaders read the tree this build actually runs
 * from.
 *
 * Every root here is derived from the running file's own `import.meta.url`
 * (`overlay-roots.ts`), so a compiled process resolves `backend/dist/apps/…`
 * without any string surgery. What did *not* follow were the file names: three
 * readers spelled `manifest.ts` / `backend.ts` / `*.ts` into an `existsSync` or
 * a suffix test, and a compiled tree spells all three `.js`.
 *
 * Two of the three failed **silently** — `if (!existsSync(...)) continue` — and
 * that is the measurement this file stands on: the same binary with
 * `DEPLOYMENT=example` logged `decoratedBy: 'example_overlay'` under `tsx` and
 * produced zero overlay lines under `node dist/index.js`, with no error and no
 * warning.
 *
 * The fixtures are committed JavaScript rather than a tree the test emits,
 * because the thing under test is the file name the loader looks for: a `.ts`
 * fixture cannot reach it (issue #130).
 *
 * **Narrowed, not deleted, by feature 103.** This file also covered the two
 * readers that classified an overlay *file* — `classifyKind` and `scanOverlay`
 * — and D-201 retired the mechanism those served. What it is about survives
 * whole in `resolveOverlayUnit`, which is the third of the three readers and
 * the only one whose failure was silent: it is what decides between `.js` and
 * `.ts` for a `manifest` and a `backend`, and it is the one that skipped every
 * overlay module in a compiled deployment with no error and no warning.
 */

const COMPILED_ROOT = join(FIXTURES, 'overlay-entries-compiled');
const NO_MANIFEST_ROOT = join(FIXTURES, 'overlay-entries-no-manifest');
const SOURCE_ROOT = join(FIXTURES, 'overlay-entries');

describe('overlay module loading, over a compiled tree', () => {
  it('composes a module whose entry point is backend.js', async () => {
    const entries = await overlayModuleEntriesUnder(COMPILED_ROOT);
    expect(entries.map((entry) => entry.id)).toEqual(['fixture_compiled']);
    expect(entries[0]?.version).toBe('4.5.6');
    expect(entries[0]?.overlay).toBe(true);
    expect(typeof entries[0]?.registerModule).toBe('function');
  });

  it('reads the manifest of a module whose manifest is manifest.js', async () => {
    const found = await overlayModuleManifestsUnder(COMPILED_ROOT);
    expect(found.map((entry) => entry.id)).toEqual(['fixture_compiled']);
    // The path is the file that exists, not the file the loader would have
    // liked: every consumer takes `dirname` of it and joins a directory.
    expect(found[0]?.filePath).toBe(
      join(COMPILED_ROOT, 'fixture_compiled', 'manifest.js'),
    );
  });

  it('still composes a source tree, so the two spellings are one path', async () => {
    const entries = await overlayModuleEntriesUnder(SOURCE_ROOT);
    expect(entries.map((entry) => entry.id)).toEqual(['fixture_composed']);
  });
});

describe('an absent file is refused where the module is registered', () => {
  it('names the module and both candidates when no manifest is there at all', async () => {
    // The scan reported this directory as a module. A manifest that is in
    // neither spelling is a build that dropped it, and the old failure was an
    // `ERR_MODULE_NOT_FOUND` naming a `.ts` path that had never existed.
    await expect(overlayModuleManifestsUnder(NO_MANIFEST_ROOT)).rejects.toThrow(
      /fixture_no_manifest[\s\S]*manifest\.js[\s\S]*manifest\.ts/,
    );
  });

  it('still skips a directory that ships a manifest and no backend entry point', async () => {
    // Unchanged and deliberate (D-103): a deployment may ship a directory that
    // composes nothing. It is the *unreadable* file that is a defect, not the
    // absent one.
    const entries = await overlayModuleEntriesUnder(SOURCE_ROOT);
    expect(entries.map((entry) => entry.id)).not.toContain('fixture_manifest_only');
  });
});

describe('discoverManifests — a module folder whose manifest is manifest.js', () => {
  it('discovers it, with the path of the file that is actually there', async () => {
    const registry = await discoverManifests({ modulesRoot: COMPILED_ROOT });
    const entry = registry.modules.get('fixture_compiled');
    expect(entry).toBeDefined();
    expect(entry?.filePath).toBe(join(COMPILED_ROOT, 'fixture_compiled', 'manifest.js'));
  });
});
