import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  overlayModuleEntriesUnder,
  overlayModuleManifestsUnder,
} from '../../../src/overlay/overlay-runtime.js';
import { classifyKind, indexCore, scanOverlay } from '../../../src/overlay/resolve-overlay.js';
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
 */

const COMPILED_ROOT = join(FIXTURES, 'overlay-entries-compiled');
const NO_MANIFEST_ROOT = join(FIXTURES, 'overlay-entries-no-manifest');
const SOURCE_ROOT = join(FIXTURES, 'overlay-entries');

const temporaryRoots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

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

describe('classifyKind — a unit keeps its kind when the tree is compiled', () => {
  it('classifies the compiled spelling exactly as the authored one', () => {
    for (const [authored, compiled] of [
      ['routes.admin.ts', 'routes.admin.js'],
      ['routes/admin.ts', 'routes/admin.js'],
      ['plugin.ts', 'plugin.js'],
      ['config.ts', 'config.js'],
      ['manifest.ts', 'manifest.js'],
      ['entities/product.ts', 'entities/product.js'],
      ['migrations/20260101T000000_x_y.ts', 'migrations/20260101T000000_x_y.js'],
      ['services/pricing-service.ts', 'services/pricing-service.js'],
      ['services/pricing-service.interface.ts', 'services/pricing-service.interface.js'],
    ] as const) {
      expect([compiled, classifyKind(compiled)]).toEqual([compiled, classifyKind(authored)]);
    }
    // …and the classification itself is the one the source tree gets.
    expect(classifyKind('routes.admin.js')).toBe('route');
    expect(classifyKind('manifest.js')).toBe('config');
    expect(classifyKind('entities/product.js')).toBe('schema');
    expect(classifyKind('services/pricing-service.js')).toBe('other');
  });
});

describe('scanOverlay — a compiled override resolves against a compiled core', () => {
  it('accepts the override and ignores the emit sidecars beside it', () => {
    const core = temporaryRoot('overlay-core-compiled-');
    writeFile(join(core, 'price_lists', 'routes.admin.js'), 'export {};');
    writeFile(join(core, 'price_lists', 'routes.admin.d.ts'), 'export {};');
    writeFile(join(core, 'price_lists', 'routes.admin.js.map'), '{}');

    const overlay = temporaryRoot('overlay-deployment-compiled-');
    writeFile(join(overlay, 'price_lists', 'routes.admin.js'), 'export {};');
    // `tsc` emits these beside every unit. They are build artefacts, not units
    // a deployment overrides, and classifying them threw
    // `UnknownOverrideTargetError` for a file nobody wrote.
    writeFile(join(overlay, 'price_lists', 'routes.admin.d.ts'), 'export {};');
    writeFile(join(overlay, 'price_lists', 'routes.admin.d.ts.map'), '{}');
    writeFile(join(overlay, 'price_lists', 'routes.admin.js.map'), '{}');

    const { contributions, newModules } = scanOverlay(overlay, indexCore(core));
    expect(newModules).toEqual([]);
    expect(contributions.map((contribution) => contribution.relPath)).toEqual([
      'routes.admin.js',
    ]);
  });

  it('still refuses a compiled schema override', () => {
    const core = temporaryRoot('overlay-core-schema-');
    writeFile(join(core, 'price_lists', 'entities/product.js'), 'export {};');
    const overlay = temporaryRoot('overlay-deployment-schema-');
    writeFile(join(overlay, 'price_lists', 'entities/product.js'), 'export {};');

    expect(() => scanOverlay(overlay, indexCore(core))).toThrow(/entities\/product\.js/);
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
