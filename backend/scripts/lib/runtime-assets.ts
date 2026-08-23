/**
 * The files a built backend needs that `tsc` does not emit — feature 080,
 * D-165 step B.
 *
 * `tsc` compiles `.ts` and copies nothing else, so a compiled tree holds every
 * module's code and none of its data: 90 translation bundles
 * (`<module>/i18n/{en,pl}.json`) and 4 taxonomy files
 * (`product_feeds/data/taxonomies/**\/*.txt`).
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

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * The extensions the running application reads out of its own tree.
 *
 * An allow-list rather than "everything that is not `.ts`", because `src/` also
 * holds files nothing reads at runtime and shipping them into the image is
 * noise: see {@link NON_RUNTIME_EXTENSIONS}. An extension in neither list stops
 * the build — a new asset kind must be ruled on rather than silently dropped,
 * which is the whole defect this module exists to close.
 */
export const RUNTIME_ASSET_EXTENSIONS: readonly string[] = ['.json', '.txt'];

/** Extensions deliberately left out of the built tree, each with its reason. */
export const NON_RUNTIME_EXTENSIONS: Readonly<Record<string, string>> = {
  '.md': 'documentation for whoever reads the source tree; no code opens one',
  '.gitkeep': 'a placeholder that keeps an empty directory in git; not a file',
};

/** One asset, as a path relative to the root it was found under (POSIX). */
export type AssetPath = string;

export interface CollectedAssets {
  /** Files to copy, relative to the source root, sorted. */
  assets: AssetPath[];
  /**
   * Files whose extension is in neither list. A non-empty array is a refusal:
   * whoever added the file knows whether the application opens it, and nobody
   * downstream does.
   */
  unclassified: AssetPath[];
}

const toPosix = (path: string): string => (sep === '/' ? path : path.split(sep).join('/'));

/** The extension key used against the two lists — `.gitkeep` has no stem. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return fileName.startsWith('.') ? fileName : '';
  return fileName.slice(dot);
}

/** Every non-`.ts` file under `root`, split into what ships and what does not. */
export function collectRuntimeAssets(root: string): CollectedAssets {
  const assets: AssetPath[] = [];
  const unclassified: AssetPath[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith('.ts')) continue;
      const ext = extensionOf(entry.name);
      const rel = toPosix(relative(root, full));
      if (RUNTIME_ASSET_EXTENSIONS.includes(ext)) assets.push(rel);
      else if (!(ext in NON_RUNTIME_EXTENSIONS)) unclassified.push(rel);
    }
  };
  walk(root);
  assets.sort();
  unclassified.sort();
  return { assets, unclassified };
}

/** Copy `assets` (paths relative to `srcRoot`) into `outRoot`, mirroring the tree. */
export function copyRuntimeAssets(
  srcRoot: string,
  outRoot: string,
  assets: readonly AssetPath[],
): number {
  for (const rel of assets) {
    const target = join(outRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(srcRoot, rel), target);
  }
  return assets.length;
}

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
 * Every registered module whose bundles are absent from the built tree.
 *
 * Keyed on **registration**, which is the half `loadModuleBundles` cannot see:
 * it is handed a directory and asked what is in it, so "no directory" and "no
 * strings" are the same input. Here the manifest has already said the module
 * ships bundles, so an absent directory is a build that dropped them.
 *
 * A module whose source directory is not under `srcRoot` is skipped rather than
 * reported: an installed package's bundles are read out of its own package
 * directory at runtime and this build ships none of it.
 */
export function auditBuiltBundles(
  modules: readonly RegisteredBundleModule[],
  srcRoot: string,
  builtRoot: string,
): BundleAuditFinding[] {
  const findings: BundleAuditFinding[] = [];
  for (const module of modules) {
    const rel = relative(srcRoot, module.moduleDir);
    if (rel.startsWith('..') || rel === '') continue;
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
