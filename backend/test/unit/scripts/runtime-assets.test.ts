import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  auditBuiltBundles,
  collectRuntimeAssets,
  copyRuntimeAssets,
  describeBundleFinding,
  extensionOf,
  FALLBACK_BUNDLE_FILE,
  NON_RUNTIME_EXTENSIONS,
  RUNTIME_ASSET_EXTENSIONS,
  type RegisteredBundleModule,
} from '../../../scripts/lib/runtime-assets.js';
import { DISCOVERED_MANIFESTS } from '../../../src/modules/_lifecycle/manifest-index.generated.js';

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
  it('finds every module translation bundle and every bundled taxonomy', () => {
    const { assets } = collectRuntimeAssets(SRC_ROOT);

    const bundles = assets.filter((path) => /\/i18n\/(en|pl)\.json$/.test(path));
    // One per shipped language, for every module that declares bundles. Derived
    // from the registry rather than written down, so a module that starts or
    // stops shipping translations moves both sides of this together.
    expect(bundles).toHaveLength(registeredBundleModules().length * 2);

    expect(assets.filter((path) => path.endsWith('.txt'))).toEqual([
      'modules/product_feeds/data/taxonomies/google_merchant/2021-09-21/en.txt',
      'modules/product_feeds/data/taxonomies/google_merchant/2021-09-21/pl.txt',
      'modules/product_feeds/data/taxonomies/meta/2026-08-02/en.txt',
      'modules/product_feeds/data/taxonomies/meta/2026-08-02/pl.txt',
    ]);
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
    const victim = modules.find((module) => module.moduleId === 'orders');
    expect(victim).toBeDefined();
    const removed = join(builtRoot, 'modules', 'orders', victim!.bundlesDir);
    expect(existsSync(removed)).toBe(true);
    rmSync(removed, { recursive: true });

    const findings = auditBuiltBundles(modules, SRC_ROOT, builtRoot);
    expect(findings).toEqual([
      { kind: 'missing-directory', moduleId: 'orders', expected: removed },
    ]);
    expect(describeBundleFinding(findings[0]!)).toContain('installed=0 failed=0');

    // Restored, because the copied tree is shared with the cases above.
    copyRuntimeAssets(
      SRC_ROOT,
      builtRoot,
      collectRuntimeAssets(SRC_ROOT).assets.filter((path) =>
        path.startsWith('modules/orders/'),
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
