/**
 * The files a compiled tree needs that `tsc` does not emit — one owner, two
 * callers (feature 080, D-165 step B and criterion 8).
 *
 * `tsc` compiles `.ts` and copies nothing else. Measured directly: a `src/`
 * holding `a.ts`, `data/t.txt`, `data/t.json` and `data/t.md` emits `dist/a.js`
 * and nothing else. So a compiled tree holds every module's code and none of
 * its data, and that is a **silent** defect rather than a crash — the readers
 * document absence as legitimate. `loadModuleBundles` says it *"returns an
 * empty map when the bundles directory does not exist (the module ships no
 * translatable strings)"*, and `TaxonomyReconcilerService.listBundledRevisions`
 * reads an absent data directory as *"no revision is bundled"*. Both are green.
 *
 * ## Why this lives at the repository root, in plain JavaScript
 *
 * Two trees compile, and both have the same hole:
 *
 *   * the **application** — `backend/scripts/copy-runtime-assets.ts`, which
 *     also audits its output against the registered module set;
 *   * a **module package** — `scripts/copy-package-assets.mjs`, run by the
 *     package's own generated `build` script.
 *
 * The second cannot be TypeScript: a module package's `devDependencies` are
 * derived from what its sources import, it has no `tsx`, and giving it one so a
 * build step could run would put the application's tooling inside a package's
 * dependency graph. And the classification must not be answered twice — a
 * module moving from `backend/src/modules/<id>/` into
 * `packages/modules/<id>/src/` must get the same answer on both sides of the
 * move, or an asset stops shipping the day the module is packaged, silently.
 * So the answer lives here once, `backend/scripts/lib/runtime-assets.ts`
 * re-exports it, and `runtime-assets.d.mts` types it for that consumer.
 */

import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * The extensions the running application reads out of its own tree.
 *
 * An allow-list rather than "everything that is not `.ts`", because a source
 * tree also holds files nothing reads at runtime and shipping them is noise:
 * see {@link NON_RUNTIME_EXTENSIONS}. An extension in neither list stops the
 * build — a new asset kind must be ruled on rather than silently dropped,
 * which is the whole defect this module exists to close.
 */
export const RUNTIME_ASSET_EXTENSIONS = ['.json', '.txt'];

/**
 * Extensions deliberately left out of the built tree, each with its reason.
 *
 * **`.md`'s reason was re-ruled by feature 100** and the classification did not
 * change, which is why the entry says what it now says. It read *"documentation
 * for whoever reads the source tree; no code opens one"*, and the second clause
 * became false the moment a module could ship its own documentation: the site
 * generator opens one. The classification survives because documentation is a
 * **package-root layer**, exactly as `i18n/` is — the platform joins a
 * manifest-declared directory to `dirname(manifestPath)` and reads it from the
 * package, so it travels in the package's `files` list and never through this
 * walk, which mirrors `rootDir` into `outDir` for assets a module reads relative
 * to its own emitted code. A `.md` under a compiled source root is still read by
 * nothing.
 *
 * Stating it that way rather than leaving the old sentence matters because this
 * is a **ruled** classification: the exit-1 case below is "an asset kind nobody
 * has ruled on", so the reason is the ruling, and a reason that has quietly
 * gone false is a ruling nobody can check.
 */
export const NON_RUNTIME_EXTENSIONS = {
  '.md':
    "documentation, which the platform reads from the package root beside `i18n/` and never " +
    'from the compiled tree — nothing under `rootDir` opens one (feature 100)',
  '.gitkeep': 'a placeholder that keeps an empty directory in git; not a file',
};

/** The extension key used against the two lists — `.gitkeep` has no stem. */
export function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return fileName.startsWith('.') ? fileName : '';
  return fileName.slice(dot);
}

const toPosix = (path) => (sep === '/' ? path : path.split(sep).join('/'));

/**
 * What a file name is, by the two lists above — `'asset'`, `'ignored'` or
 * `'unclassified'`.
 *
 * The **rule** has one owner; the **walk** does not, deliberately. Two callers
 * walk with different filesystems — this file's own `readdirSync`, and the
 * manifest generator's injected `ManifestFs`, whose red proofs hand in a whole
 * synthetic checkout — and a walk cannot be shared across those without one of
 * them growing an abstraction for the other's sake. What must never be
 * answered twice is which extension ships, so that is what this exports.
 */
export function classifyAssetFile(fileName) {
  // `.tsx` is source, exactly as `.ts` is — a module package's admin layer
  // (feature 091) is React components, and `tsc` emits them from
  // `tsconfig.ui.json`. It is named here rather than left to the two lists
  // because it is neither an asset nor a deliberate omission: it is the thing
  // the compiler compiles, and calling it `unclassified` stopped the manifest
  // generator on the first module to ship a screen.
  if (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) return 'ignored';
  const ext = extensionOf(fileName);
  if (RUNTIME_ASSET_EXTENSIONS.includes(ext)) return 'asset';
  return ext in NON_RUNTIME_EXTENSIONS ? 'ignored' : 'unclassified';
}

/**
 * Every non-`.ts` file under `root`, split into what ships and what does not.
 *
 * `scanned` is every file the walk saw, `.ts` and ruled-out kinds included —
 * the number a `read:` line has to print, because "4 assets" over a tree of
 * four files and "4 assets" over a tree of four hundred are different results
 * and only one of them means the walk read what it thinks it read (issue #244).
 */
export function collectRuntimeAssets(root) {
  const assets = [];
  const unclassified = [];
  let scanned = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      const kind = classifyAssetFile(entry.name);
      if (kind === 'ignored') continue;
      const rel = toPosix(relative(root, full));
      if (kind === 'asset') assets.push(rel);
      else unclassified.push(rel);
    }
  };
  walk(root);
  assets.sort();
  unclassified.sort();
  return { assets, unclassified, scanned };
}

/** Copy `assets` (paths relative to `srcRoot`) into `outRoot`, mirroring the tree. */
export function copyRuntimeAssets(srcRoot, outRoot, assets) {
  for (const rel of assets) {
    const target = join(outRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(srcRoot, rel), target);
  }
  return assets.length;
}

/**
 * The assets the source tree ships that the built tree does not hold.
 *
 * Run **after** the copy, over the same list, so the step audits its own
 * output rather than trusting that `cpSync` did what it was asked. It is the
 * one place where the two cases are still distinguishable: here the source
 * tree has already said the asset exists, whereas every reader downstream is
 * handed a directory and asked what is in it, for which "absent" and "empty"
 * are the same input.
 */
export function auditCopiedAssets(outRoot, assets) {
  return assets.filter((rel) => !existsSync(join(outRoot, rel)));
}
