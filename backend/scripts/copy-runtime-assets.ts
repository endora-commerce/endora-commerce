/**
 * Build step — put the files `tsc` does not emit into the built tree, and
 * refuse a tree that is missing any of them (feature 080, D-165 step B).
 *
 * `tsc` compiles `.ts` and copies nothing else, so `pnpm --filter backend run
 * build` used to produce a tree with every module's code and none of its data.
 * The consequence is not a crash: `loadModuleBundles` reads an absent bundles
 * directory as *"this module ships no translatable strings"*, so the boot
 * reports `installed=0 skipped=21 failed=0` and serves raw i18n keys, and
 * `TaxonomyReconcilerService.listBundledRevisions` reads an absent data
 * directory as *"no revision is bundled"* and installs none. Both are green.
 *
 * So this runs after the compile, and it **audits its own output**: every
 * registered module that declares `i18n.bundlesDir` must have those bundles in
 * the built tree. That check is possible here and nowhere downstream, because
 * here the manifest has already said the module ships them.
 *
 * Usage: `tsx scripts/copy-runtime-assets.ts [--out <dir>]`
 * Exit 0 = the built tree holds every asset the source tree ships;
 * exit 1 = an asset kind nobody has ruled on, or a registered module whose
 *          bundles are not there;
 * exit 2 = nothing was read — no source tree, no assets, no registered module
 *          declaring bundles. A vacuous pass is not a pass.
 */
/* eslint-disable no-console -- build step: stdout/stderr is the interface. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCOVERED_MANIFESTS } from '../src/modules/_lifecycle/manifest-index.generated.js';
import {
  auditBuiltBundles,
  bundleModulesUnder,
  collectRuntimeAssets,
  copyRuntimeAssets,
  describeBundleFinding,
  NON_RUNTIME_EXTENSIONS,
  RUNTIME_ASSET_EXTENSIONS,
  type RegisteredBundleModule,
} from './lib/runtime-assets.js';

const BACKEND_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_ROOT = join(BACKEND_ROOT, 'src');

function outRootFrom(argv: readonly string[]): string {
  const flag = argv.indexOf('--out');
  const value = flag >= 0 ? argv[flag + 1] : undefined;
  return value === undefined ? join(BACKEND_ROOT, 'dist') : join(process.cwd(), value);
}

/** Every core module that declares translation bundles, from the generated index. */
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

function main(): number {
  const outRoot = outRootFrom(process.argv.slice(2));

  if (!existsSync(SRC_ROOT)) {
    console.error(`[runtime-assets] ${SRC_ROOT} does not exist — nothing to copy from.`);
    return 2;
  }
  if (!existsSync(outRoot)) {
    console.error(
      `[runtime-assets] ${outRoot} does not exist. This step runs after the compile; ` +
        'run `tsc -p tsconfig.build.json` first (or `pnpm --filter backend run build`, ' +
        'which does both).',
    );
    return 2;
  }

  const { assets, unclassified } = collectRuntimeAssets(SRC_ROOT);
  if (unclassified.length > 0) {
    console.error(
      `[runtime-assets] ${unclassified.length} file(s) under src/ have an extension this ` +
        'build has no ruling for. Whoever added them knows whether the application opens ' +
        'one at runtime, and nobody downstream does — an unshipped asset is read as an ' +
        'absent feature, silently. Add the extension to RUNTIME_ASSET_EXTENSIONS ' +
        `(currently ${RUNTIME_ASSET_EXTENSIONS.join(', ')}) or to NON_RUNTIME_EXTENSIONS ` +
        `(currently ${Object.keys(NON_RUNTIME_EXTENSIONS).join(', ')}) with a reason, in ` +
        'scripts/lib/runtime-assets.ts:',
    );
    for (const path of unclassified) console.error(`  src/${path}`);
    return 1;
  }
  if (assets.length === 0) {
    console.error(
      `[runtime-assets] no runtime asset found under ${SRC_ROOT}. Every module that ` +
        'declares `i18n.bundlesDir` ships two of them and `product_feeds` ships four ' +
        'taxonomy files; finding none means the walk did not read what it thinks it read.',
    );
    return 2;
  }

  const bundleModules = registeredBundleModules();
  if (bundleModules.length === 0) {
    console.error(
      '[runtime-assets] the generated manifest index declares no module with an ' +
        '`i18n.bundlesDir`, so the audit below would pass over an empty population. ' +
        'Run `pnpm --filter backend run composer:generate`.',
    );
    return 2;
  }

  const copied = copyRuntimeAssets(SRC_ROOT, outRoot, assets);

  const findings = auditBuiltBundles(bundleModules, SRC_ROOT, outRoot);
  if (findings.length > 0) {
    console.error(
      `[runtime-assets] ${findings.length} registered module(s) have no translation ` +
        'bundles in the built tree:',
    );
    for (const finding of findings) console.error(`  ${describeBundleFinding(finding)}`);
    return 1;
  }

  // `compiled` is the half this build ships; the rest are module packages,
  // whose bundles travel with the package (`bundleModulesUnder`). Printing both
  // is what keeps "44 of 45" from reading as a shortfall.
  const compiled = bundleModulesUnder(bundleModules, SRC_ROOT);
  console.log(
    `[runtime-assets] copied: files=${copied} into ${outRoot} ` +
      `bundles=${compiled.length}/${bundleModules.length} (manifest-index)`,
  );
  return 0;
}

process.exit(main());
