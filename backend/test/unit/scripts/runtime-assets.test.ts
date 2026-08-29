import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  auditBuiltBundles,
  bundleModulesUnder,
  collectRuntimeAssets,
  copyRuntimeAssets,
  describeBundleFinding,
  extensionOf,
  FALLBACK_BUNDLE_FILE,
  NON_RUNTIME_EXTENSIONS,
  RUNTIME_ASSET_EXTENSIONS,
  type RegisteredBundleModule,
} from '../../../scripts/lib/runtime-assets.js';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';

/**
 * D-165 step B — the assets a compiled backend needs, and the audit that
 * refuses a built tree without them.
 *
 * **Why this test exists rather than a boot assertion.** The compiled boot is
 * green without a single translation bundle: `tsc` copies no JSON, and
 * `loadModuleBundles` reads an absent directory as *"this module ships no
 * translatable strings"* — a legitimate answer it cannot distinguish from a
 * build that dropped them. The reconciler then logs
 * `installed=0 skipped=21 failed=0` and every admin screen renders raw i18n
 * keys. Nothing else in the estate can see this, because the code that would
 * notice is the code that documents absence as legitimate.
 *
 * So the noticing happens where the two cases are still distinguishable —
 * against the **registered** module set — and it happens over a tree this file
 * builds with the shipped copier, so the assertion needs no 30 s compile and
 * can never be vacuously green for want of a `dist/`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
const SRC_ROOT = join(BACKEND_ROOT, 'src');

/** Every core module that declares translation bundles, as the audit takes them. */
function registeredBundleModules(): RegisteredBundleModule[] {
  const modules: RegisteredBundleModule[] = [];
  for (const entry of DISCOVERED_MANIFESTS) {
    const bundlesDir = entry.manifest.i18n?.bundlesDir;
    if (bundlesDir === undefined) continue;
    modules.push({
      moduleId: entry.manifest.id,
      moduleDir: dirname(entry.manifestPath),
      bundlesDir,
    });
  }
  return modules;
}

let builtRoot: string;
const temporaryRoots: string[] = [];

function temporaryRootNamed(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

beforeAll(() => {
  // The tree the audit reads is produced by the code the build runs, from the
  // real `src/` — the fixture enters at the top of the analysis (issue #130),
  // never as a pre-built list of what the copier "would" have done.
  builtRoot = temporaryRootNamed('runtime-assets-built-');
  const { assets, unclassified } = collectRuntimeAssets(SRC_ROOT);
  expect(unclassified).toEqual([]);
  copyRuntimeAssets(SRC_ROOT, builtRoot, assets);
});

afterEach(() => {
  for (const root of temporaryRoots.splice(1)) rmSync(root, { recursive: true, force: true });
});

describe('collectRuntimeAssets — what a compiled tree is missing', () => {
  it('finds every translation bundle this application compiles, and no other kind', () => {
    const { assets } = collectRuntimeAssets(SRC_ROOT);

    const bundles = assets.filter((path) => /\/i18n\/(en|pl)\.json$/.test(path));
    // One per shipped language, for every module that declares bundles **and
    // whose sources this build compiles**. Derived from the registry rather than
    // written down, so a module that starts or stops shipping translations moves
    // both sides of this together.
    //
    // `bundleModulesUnder` is the narrowing, and it is the audit's own — a
    // module package's bundles sit beside its `dist` and travel with it, so this
    // copier neither reads nor ships them. Without it the two sides disagreed by
    // exactly the packaged modules (90 against 88, when `blog` moved), which
    // reads as a dropped bundle and is not one.
    const compiled = bundleModulesUnder(registeredBundleModules(), SRC_ROOT);
    expect(compiled.length).toBeGreaterThan(0);
    expect(bundles).toHaveLength(compiled.length * 2);

    // **`.txt` used to be asserted here by name and no longer is**, and the
    // reason is worth a sentence rather than a deletion. The four Google/Meta
    // taxonomy files were `backend/src`'s only non-bundle asset; they left with
    // `product_feeds` when it became a workspace package (feature 080,
    // criterion 8), so this walk correctly finds none. Their successor
    // assertion is `test/unit/packages/package-runtime-assets.test.ts`, which
    // makes the same claim about the tree they are in now — and about every
    // module package's built output, which is the half no source-tree check
    // can see. What stays here is the claim this walk *can* still make.
    expect(assets.every((path) => path.endsWith('.json'))).toBe(true);
  });

  it('leaves out the file kinds nothing opens at runtime, and says why', () => {
    const { assets } = collectRuntimeAssets(SRC_ROOT);
    expect(assets.some((path) => path.endsWith('.md'))).toBe(false);
    expect(assets.some((path) => path.endsWith('.gitkeep'))).toBe(false);
    for (const reason of Object.values(NON_RUNTIME_EXTENSIONS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('reports an extension it has no ruling for instead of dropping it', () => {
    // A build that silently ships nothing for a new asset kind is the same
    // defect one directory over, so a kind neither list names stops the build.
    const root = temporaryRootNamed('runtime-assets-unknown-');
    mkdirSync(join(root, 'modules', 'invoices'), { recursive: true });
    writeFileSync(join(root, 'modules', 'invoices', 'template.hbs'), 'x');
    writeFileSync(join(root, 'modules', 'invoices', 'service.ts'), 'export {};');

    const { assets, unclassified } = collectRuntimeAssets(root);
    expect(assets).toEqual([]);
    expect(unclassified).toEqual(['modules/invoices/template.hbs']);
  });

  it('classifies an extension-less dotfile by its own name', () => {
    expect(extensionOf('.gitkeep')).toBe('.gitkeep');
    expect(extensionOf('en.json')).toBe('.json');
    expect(extensionOf('README')).toBe('');
    expect(RUNTIME_ASSET_EXTENSIONS).toContain('.json');
  });
});

describe('auditBuiltBundles — a registered module whose bundles are not in the built tree', () => {
  it('is clean for a built tree the copier produced', () => {
    expect(auditBuiltBundles(registeredBundleModules(), SRC_ROOT, builtRoot)).toEqual([]);
  });

  it('is not vacuous — the audit has a module set to answer about', () => {
    // A green over an empty population is the failure this whole file is about.
    expect(registeredBundleModules().length).toBeGreaterThan(40);
  });

  it('goes red when one registered module’s bundle directory is removed', () => {
    const modules = registeredBundleModules();
    // The victim is **derived, never named**, and so is *where its bundles
    // land*. This assertion read `moduleId === 'orders'` until T040b packaged
    // that module, at which point the built tree the copier produces from
    // `src/` held no directory for it; it then looked under
    // `modules/<id>/<bundlesDir>`, which is a second fact about the layout and
    // outlived the first by one merge request — with `_i18n` packaged and
    // `_lifecycle` host-owned at `src/lifecycle/` (D-160.11), no registered
    // module's bundles sit under `modules/` at all and the proof failed on its
    // own fixture rather than on the audit. The built path is therefore
    // computed the way `auditBuiltBundles` computes it, from the module's own
    // directory relative to `src/`, so the proof follows a module wherever the
    // application keeps it.
    const builtBundlesOf = (module: RegisteredBundleModule): string =>
      join(builtRoot, relative(SRC_ROOT, module.moduleDir), module.bundlesDir);
    const victim = modules.find((module) => existsSync(builtBundlesOf(module)));
    expect(
      victim,
      'the copier emitted no module bundle directory at all, so there is nothing to remove',
    ).toBeDefined();
    const removed = builtBundlesOf(victim!);
    expect(existsSync(removed)).toBe(true);
    rmSync(removed, { recursive: true });

    const findings = auditBuiltBundles(modules, SRC_ROOT, builtRoot);
    expect(findings).toEqual([
      { kind: 'missing-directory', moduleId: victim!.moduleId, expected: removed },
    ]);
    expect(describeBundleFinding(findings[0]!)).toContain('installed=0 failed=0');

    // Restored, because the copied tree is shared with the cases above — and
    // restored for the module the victim search actually chose, not for a module
    // id written down here. The two must agree: a restore naming a different
    // module leaves the removal in place and reds the *next* case instead.
    copyRuntimeAssets(
      SRC_ROOT,
      builtRoot,
      collectRuntimeAssets(SRC_ROOT).assets.filter((path) =>
        path.startsWith(`${relative(SRC_ROOT, victim!.moduleDir).split(sep).join('/')}/`),
      ),
    );
    expect(auditBuiltBundles(modules, SRC_ROOT, builtRoot)).toEqual([]);
  });

  it('goes red when the directory is there but the English fallback is not', () => {
    const root = temporaryRootNamed('runtime-assets-nofallback-');
    mkdirSync(join(root, 'modules', 'orders', 'i18n'), { recursive: true });
    writeFileSync(join(root, 'modules', 'orders', 'i18n', 'pl.json'), '{}');

    expect(
      auditBuiltBundles(
        [{ moduleId: 'orders', moduleDir: join(SRC_ROOT, 'modules', 'orders'), bundlesDir: 'i18n' }],
        SRC_ROOT,
        root,
      ),
    ).toEqual([
      {
        kind: 'missing-fallback',
        moduleId: 'orders',
        expected: join(root, 'modules', 'orders', 'i18n', FALLBACK_BUNDLE_FILE),
      },
    ]);
  });

  it('says nothing about a module this build does not ship', () => {
    // An installed package's bundles are read from its own package directory at
    // runtime; a built backend tree is not where they would be.
    expect(
      auditBuiltBundles(
        [
          {
            moduleId: 'vendor_thing',
            moduleDir: '/somewhere/node_modules/@vendor/mod-thing',
            bundlesDir: 'i18n',
          },
        ],
        SRC_ROOT,
        builtRoot,
      ),
    ).toEqual([]);
  });
});

describe('the build is what runs the copier', () => {
  it('names copy-runtime-assets in backend’s build script', async () => {
    // The audit above only bites if something calls it. Asserted here for the
    // same reason `check-release-intent.test.ts` asserts that `.gitlab-ci.yml`
    // still names `test:release-gate`: a step nothing runs is a step that is
    // not there.
    const manifest = (await import('../../../package.json', { with: { type: 'json' } })) as {
      default: { scripts: Record<string, string> };
    };
    expect(manifest.default.scripts['build']).toContain('copy-runtime-assets');
  });
});
