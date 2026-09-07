import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { discoverModulePackages } from '../../../scripts/lib/module-packages.js';
import type { DiscoveredManifestEntry } from '../../../src/manifest-index.generated.js';
import {
  ModuleManifestPathUnresolvableError,
  resolveManifestPath,
} from '../../../src/manifest-locations.js';
import {
  ManifestPathMissingError,
  REGISTERED_MANIFESTS,
  coreManifestEntries,
  resolvedManifestEntries,
} from '../../../src/lifecycle/registered-manifests.js';

/** `backend/src`, derived from this file rather than spelled. */
const BACKEND_SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src');

/**
 * `REGISTERED_MANIFESTS` is a derivation of the generated manifest index, not a
 * second enumeration of it (feature 071, F2).
 *
 * Both files used to import the same manifests statically, refreshed by two
 * different commands, and only a full build ran both — so one could name a
 * module directory the other had already lost. One of the two facts the second
 * file carried is genuinely derivable — its install hooks are exports of the
 * manifest the index already imports. The other, its `filePath`, was **not**,
 * and was fabricated as `<modules root>/<id>/manifest.ts` for a year; feature
 * 080's T041a moves it back onto the index as emitted data, because a module
 * may now live in a workspace package and the convention answers a directory
 * that is not there. See the third describe block.
 *
 * Since D-104 the index is **bare core under every value of `DEPLOYMENT`**, so
 * there is no overlay entry in it to filter and no per-deployment `filePath` to
 * reconstruct from it. The deployment half is a runtime discovery, and
 * `resolvedManifestEntries()` is the one implementation of it — there used to be
 * two, and the one under test was not the one that ran.
 *
 * The derivation cases run on synthetic entries rather than the real index: the
 * real tree has few hooks, so a test reading it could not tell a working
 * derivation from one that dropped hooks entirely.
 */

const manifestOf = (id: string): ModuleManifest => ({
  id,
  name: id,
  version: '1.0.0',
  dependencies: [],
});

const noop = async (): Promise<void> => {};

const BLOG: DiscoveredManifestEntry = {
  id: 'blog',
  manifest: manifestOf('blog'),
  manifestPath: '/repo/backend/src/modules/blog/manifest.ts',
};
const CMS: DiscoveredManifestEntry = {
  id: 'cms',
  manifest: manifestOf('cms'),
  manifestPath: '/repo/backend/src/modules/cms/manifest.ts',
};
const HOOKED: DiscoveredManifestEntry = {
  id: 'custom_fields',
  manifest: manifestOf('custom_fields'),
  manifestPath: '/repo/backend/src/modules/custom_fields/manifest.ts',
  installHook: noop,
  uninstallHook: noop,
};

describe('coreManifestEntries — the core registry, derived', () => {
  it('carries one entry per core module, in index order', () => {
    const entries = coreManifestEntries([BLOG, CMS]);
    expect(entries.map((e) => e.manifest.id)).toEqual(['blog', 'cms']);
  });

  it('reads filePath off the index entry rather than computing it from the id', () => {
    // Feature 080, T041a. The entry names a location the id-and-modules-root
    // convention would never produce, and it is the location that comes back.
    const packaged: DiscoveredManifestEntry = {
      id: 'blog',
      manifest: manifestOf('blog'),
      manifestPath: '/repo/packages/modules/blog/package.json',
    };

    expect(coreManifestEntries([packaged])[0]?.filePath).toBe(
      '/repo/packages/modules/blog/package.json',
    );
    expect(coreManifestEntries([BLOG])[0]?.filePath).toBe(
      '/repo/backend/src/modules/blog/manifest.ts',
    );
  });

  it('carries the install and uninstall hooks the index detected', () => {
    const [entry] = coreManifestEntries([HOOKED]);
    expect(entry?.installHook).toBe(noop);
    expect(entry?.uninstallHook).toBe(noop);
  });

  it('omits a hook key a module does not export, rather than setting it undefined', () => {
    const [entry] = coreManifestEntries([BLOG]);
    expect(entry && 'installHook' in entry).toBe(false);
    expect(entry && 'uninstallHook' in entry).toBe(false);
  });
});

describe('a module’s location is answered, or refused — never guessed (T041a)', () => {
  /**
   * The failure this replaces had no signal of any kind.
   *
   * `pathFor(id)` returned `<modules root>/<id>/manifest.ts` whatever the tree
   * held. Downstream, `_i18n`'s boot reconciler and the lifecycle orchestrator
   * both take `dirname` of it and join `bundlesDir`; both **log and skip** a
   * directory that is not there. So a module living anywhere else — which is
   * what `packages/modules/<id>/` is (D-141) — loaded no bundle, rendered every
   * command-palette entry as its raw i18n key, and produced no error, no warning
   * and no failing check. The three tests below are the two halves of the
   * repair: the index carries the real location, and each half refuses rather
   * than substituting one it invented.
   */
  it('refuses an index entry that carries no location at all', () => {
    // Enters where a real run enters — the discovered array `coreManifestEntries`
    // is called with. The cast is the point of the test rather than a way round
    // the type: the field is required, so a *new* emitter cannot omit it, and
    // what this covers is the artefact the type cannot reach — a committed index
    // generated before the field existed, or edited by hand.
    const withoutPath = { id: 'blog', manifest: manifestOf('blog') } as DiscoveredManifestEntry;

    expect(() => coreManifestEntries([withoutPath])).toThrow(ManifestPathMissingError);
    expect(() => coreManifestEntries([withoutPath])).toThrow(/blog/);
  });

  it('refuses an empty location, which is the shape `dirname` turns into "."', () => {
    // The one value that would reproduce the original failure exactly:
    // `dirname('')` is `'.'`, so every bundle lookup becomes a relative read
    // against whatever the process's working directory happens to be.
    const empty: DiscoveredManifestEntry = {
      id: 'blog',
      manifest: manifestOf('blog'),
      manifestPath: '',
    };

    expect(() => coreManifestEntries([empty])).toThrow(ManifestPathMissingError);
  });

  it('refuses a specifier that reaches no file, instead of returning where it looked', () => {
    // The resolver's own half, entered at the top: an index URL and a specifier,
    // exactly the two values the generated artefact passes it. The relative
    // shape is tried as `.js` and then as `.ts`, because one tree is compiled
    // and the other is not, and the refusal names both candidates.
    const indexUrl = pathToFileURL(
      join(BACKEND_SRC, 'modules', '_lifecycle', 'manifest-index.generated.ts'),
    ).href;

    expect(() => resolveManifestPath(indexUrl, '../no_such_module/manifest.js')).toThrow(
      ModuleManifestPathUnresolvableError,
    );
    expect(() => resolveManifestPath(indexUrl, '@endora-commerce/mod-no-such-package')).toThrow(
      ModuleManifestPathUnresolvableError,
    );
  });

  it('resolves a real module through the extension the running tree actually has', () => {
    // The control, and it is what makes the two refusals above mean something:
    // over this repository the same call answers with a file that exists. Under
    // `vitest` that is `manifest.ts`, and in a `dist` build it is `manifest.js`;
    // the assertion is `existsSync`, never an extension, so it holds in both.
    //
    // The module is taken from the tree rather than named, and so is **where**
    // it sits: this read `blog` until that module became a package (feature
    // 080, T040b), then `modules/<id>/`, then "under `backend/src`", then "the
    // one module the index names relatively", which was `_lifecycle` from
    // D-160.11's second half until `specs/115-lifecycle-container-move/` Phase 6
    // gave it `@endora-commerce/platform/lifecycle`. Four expiry dates, each a
    // fact about the layout that the layout then changed — and the last one left
    // this control sampling an **empty** population, which is the failure it was
    // written to avoid.
    //
    // So it is no longer sampled from the registry at all. The relative branch
    // is a live code path with no caller in this tree today — a module in the
    // application's own tree has one, and a client instance's scaffolded index
    // may — and what it has to be exercised over is a **real** manifest file,
    // reached relatively, so that the `.js` → `.ts` fallback is the thing under
    // test. A module package's own `src/manifest.ts` is exactly that: named
    // relatively from `backend/src` it exists as `.ts` and not as `.js`, which
    // is the fallback, and in a `dist` build the same call answers the emitted
    // file. The bare shape is exercised in the test below, over the same
    // packages.
    const indexUrl = pathToFileURL(join(BACKEND_SRC, 'manifest-index.generated.ts')).href;
    const packages = discoverModulePackages(join(BACKEND_SRC, '..', '..'));
    expect(packages.length, 'this checkout declares no module package').toBeGreaterThan(0);
    const directory = join(packages[0]!.dir, 'src');

    const within = relative(BACKEND_SRC, directory).split(sep).join('/');
    const specifier = `${within.startsWith('.') ? within : `./${within}`}/manifest.js`;
    const resolved = resolveManifestPath(indexUrl, specifier);

    expect(existsSync(resolved)).toBe(true);
    expect(dirname(resolved)).toBe(directory);
  });

  it('resolves a packaged module through its own package.json, so dirname() is the package', () => {
    // The bare half of the same contract (D-149). It is what makes a packaged
    // module's i18n bundles load at all: every consumer takes `dirname` of this
    // and joins `bundlesDir`, and the `_i18n` reconciler logs and skips a
    // directory that is not there — so getting this wrong renders every one of
    // that module's palette labels as its raw key, with nothing reported.
    //
    // Skipped when this checkout has no module package, which is the state the
    // tree was in before T040b and the state a fixture tree is in.
    const packages = discoverModulePackages(join(BACKEND_SRC, '..', '..'));
    if (packages.length === 0) return;
    const indexUrl = pathToFileURL(
      join(BACKEND_SRC, 'modules', '_lifecycle', 'manifest-index.generated.ts'),
    ).href;

    for (const pkg of packages) {
      const resolved = resolveManifestPath(indexUrl, pkg.name);

      expect(existsSync(resolved), resolved).toBe(true);
      expect(dirname(resolved)).toBe(pkg.dir);

      // The bundles are asserted **where the manifest declares them**, and the
      // declared directory is read rather than spelled. This block asserted a
      // literal `i18n/en.json` for every package until the fourth one arrived:
      // `credit_limits` declares no `i18n` block at all — its one permission
      // code lives in the core `PERMISSION_CATALOGUE` and it publishes no
      // palette action — so it ships no bundle and is right not to. Asserting
      // one for it would have been this test making up a rule the reconciler
      // does not have; the rule the reconciler *does* have is "the directory a
      // manifest declares must be on disk", which is what runs here.
      const bundlesDir = REGISTERED_MANIFESTS.find((entry) => entry.manifest.id === pkg.moduleId)?.manifest
        .i18n?.bundlesDir;
      if (bundlesDir === undefined) continue;
      for (const language of ['en', 'pl']) {
        expect(
          existsSync(join(dirname(resolved), bundlesDir, `${language}.json`)),
          `${pkg.name} declares i18n.bundlesDir='${bundlesDir}' and ships no ${language}.json`,
        ).toBe(true);
      }
    }
  });

  it('gives every committed entry a location that is on disk — the whole index', () => {
    // The property the two consumers depend on, over the real artefact rather
    // than a fixture: `dirname(filePath)` is a directory that exists for all 66
    // registered modules. A module that moves without the artefact being
    // regenerated fails here and at the first import of the index, which is the
    // opposite of the silence this replaced.
    const missing = REGISTERED_MANIFESTS.filter((entry) => !existsSync(dirname(entry.filePath)));

    expect(missing.map((entry) => `${entry.manifest.id} -> ${entry.filePath}`)).toEqual([]);
  });
});

describe('the committed index is bare core, whatever DEPLOYMENT was set to (D-104)', () => {
  it('holds no deployment’s module', () => {
    // FR-004 by construction rather than by filtering: the generator no longer
    // has an overlay branch to walk, so there is nothing here to leave out.
    expect(REGISTERED_MANIFESTS.map((e) => e.manifest.id)).not.toContain('example_overlay');
  });
});

describe('resolvedManifestEntries — the deployment-resolved set, discovered at runtime', () => {
  it('adds the deployment’s overlay module, with its filePath under the deployment root', async () => {
    const resolved = await resolvedManifestEntries({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const entry = resolved.find((e) => e.manifest.id === 'example_overlay');
    expect(entry).toBeDefined();
    expect(entry?.filePath).toMatch(
      /backend[/\\]src[/\\]apps[/\\]example[/\\]modules[/\\]example_overlay[/\\]manifest\.ts$/,
    );
  });

  it('keeps every core entry exactly once, and appends the deployment’s', async () => {
    const resolved = await resolvedManifestEntries({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const ids = resolved.map((e) => e.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, REGISTERED_MANIFESTS.length)).toEqual(
      REGISTERED_MANIFESTS.map((e) => e.manifest.id),
    );
    expect(ids).toContain('example_overlay');
  });

  it('returns the core registry unchanged for a bare-core build (FR-008)', async () => {
    const resolved = await resolvedManifestEntries({} as NodeJS.ProcessEnv);
    expect(resolved).toEqual([...REGISTERED_MANIFESTS]);
  });

  it('reads the deployment from its argument, so one process can resolve both', async () => {
    // The property the harness depends on: a suite proves the module present
    // with the deployment selected and absent without it, in one run. An
    // ambient `DEPLOYMENT` read at import time could answer only one of them.
    const withDeployment = await resolvedManifestEntries({
      DEPLOYMENT: 'example',
    } as NodeJS.ProcessEnv);
    const bareCore = await resolvedManifestEntries({} as NodeJS.ProcessEnv);
    expect(withDeployment.length).toBe(bareCore.length + 1);
  });
});
