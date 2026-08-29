/**
 * The files a built backend needs that `tsc` does not emit — feature 080,
 * D-165 step B.
 *
 * `tsc` compiles `.ts` and copies nothing else, so a compiled tree holds every
 * module's code and none of its data: two translation bundles
 * (`<module>/i18n/{en,pl}.json`) for every module the application itself
 * compiles.
 *
 * **The walk, the classification and the copy are not here.** They are
 * `scripts/lib/runtime-assets.mjs` at the repository root, because a module
 * package's build has the same hole and has to close it under bare `node`
 * (criterion 8) — and because a module moving out of `backend/src/modules/`
 * into `packages/modules/` must get the same answer about the same file on
 * both sides of the move. What stays here is the half that is about *this*
 * application: the audit against the **registered** module set.
 *
 * **The reason this needs a check and not just a copy** is that nothing
 * downstream can tell the difference. `loadModuleBundles` documents that it
 * *"returns an empty map when the bundles directory does not exist (the module
 * ships no translatable strings)"* — a legitimate answer for a module with
 * nothing to say, and the only answer available to a module whose bundles were
 * never copied. The reconciler then reports `installed=0 skipped=21 failed=0`
 * and the boot is green while every admin screen renders raw i18n keys. The
 * code that would notice is the code that documents absence as legitimate, so
 * the noticing has to happen here, where the two cases are still
 * distinguishable: this module knows which modules are *registered*, and a
 * registered module that declares a `bundlesDir` and has none in the built tree
 * is a defect, never a module with nothing to say.
 *
 * Everything here is pure over its roots so the audit can be driven over a tree
 * a test builds, rather than over a `dist` that only exists after a 30 s
 * compile (issue #130 — a fixture must enter at the top of the analysis).
 */

import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export {
  auditCopiedAssets,
  collectRuntimeAssets,
  copyRuntimeAssets,
  extensionOf,
  NON_RUNTIME_EXTENSIONS,
  RUNTIME_ASSET_EXTENSIONS,
  type AssetPath,
  type CollectedAssets,
} from '../../../scripts/lib/runtime-assets.mjs';

/** A registered module's translation bundles, as the audit needs them. */
export interface RegisteredBundleModule {
  moduleId: string;
  /** The module's own directory in the **source** tree. */
  moduleDir: string;
  /** The manifest's `i18n.bundlesDir`, relative to {@link moduleDir}. */
  bundlesDir: string;
}

export type BundleAuditFinding =
  | {
      kind: 'missing-directory';
      moduleId: string;
      /** Where the built tree should hold the module's bundles. */
      expected: string;
    }
  | {
      kind: 'missing-fallback';
      moduleId: string;
      /** Where `en.json` should be. */
      expected: string;
    };

/** English is the platform-wide fallback (feature 019, FR-016). */
export const FALLBACK_BUNDLE_FILE = 'en.json';

/**
 * The bundle-declaring modules whose sources this build actually compiles —
 * i.e. those under `srcRoot`.
 *
 * Two kinds of module are outside it and both are correct to leave out. An
 * **installed** package's bundles are read out of its own package directory at
 * runtime, and this build ships none of it. A **workspace module package** is
 * the same case for the same reason: `packages/modules/<id>/i18n/` travels with
 * that package's own `files` list, `dirname(manifestPath)` resolves to the
 * package at runtime, and `tsc -p backend/tsconfig.build.json` never sees the
 * directory — so copying it into `backend/dist` would put a second copy
 * somewhere nothing reads.
 *
 * It is one function because three callers ask it and a copy per caller is
 * three answers waiting to disagree: the copier's report, the audit's
 * population, and `test/unit/scripts/runtime-assets.test.ts`'s expectation,
 * which went red at `90 vs 88` the day the first module became a package.
 */
export function bundleModulesUnder(
  modules: readonly RegisteredBundleModule[],
  srcRoot: string,
): RegisteredBundleModule[] {
  return modules.filter((module) => {
    const rel = relative(srcRoot, module.moduleDir);
    return rel !== '' && !rel.startsWith('..');
  });
}

/**
 * Every registered module whose bundles are absent from the built tree.
 *
 * Keyed on **registration**, which is the half `loadModuleBundles` cannot see:
 * it is handed a directory and asked what is in it, so "no directory" and "no
 * strings" are the same input. Here the manifest has already said the module
 * ships bundles, so an absent directory is a build that dropped them.
 *
 * A module whose source directory is not under `srcRoot` is out of the
 * population rather than reported — see {@link bundleModulesUnder}.
 */
export function auditBuiltBundles(
  modules: readonly RegisteredBundleModule[],
  srcRoot: string,
  builtRoot: string,
): BundleAuditFinding[] {
  const findings: BundleAuditFinding[] = [];
  for (const module of bundleModulesUnder(modules, srcRoot)) {
    const rel = relative(srcRoot, module.moduleDir);
    const expected = join(builtRoot, rel, module.bundlesDir);
    if (!existsSync(expected) || !statSync(expected).isDirectory()) {
      findings.push({ kind: 'missing-directory', moduleId: module.moduleId, expected });
      continue;
    }
    const fallback = join(expected, FALLBACK_BUNDLE_FILE);
    if (!existsSync(fallback)) {
      findings.push({ kind: 'missing-fallback', moduleId: module.moduleId, expected: fallback });
    }
  }
  return findings;
}

/** One human-readable line per finding, for a build that is about to refuse. */
export function describeBundleFinding(finding: BundleAuditFinding): string {
  return finding.kind === 'missing-directory'
    ? `module "${finding.moduleId}" declares i18n bundles, and the built tree has no ` +
        `directory at ${finding.expected}. Nothing downstream reports this: the loader ` +
        `reads an absent directory as "this module ships no translatable strings" and the ` +
        `boot logs installed=0 failed=0.`
    : `module "${finding.moduleId}" has a bundles directory in the built tree but no ` +
        `${FALLBACK_BUNDLE_FILE} at ${finding.expected}; English is the platform-wide ` +
        `fallback (FR-016).`;
}
