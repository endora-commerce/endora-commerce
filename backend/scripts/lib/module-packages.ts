/**
 * "Which of this repository's workspace members is a module, and how does a
 * generated artefact name a file inside one?" (feature 080, T041a; D-149.)
 *
 * `generate-composer.ts` had no notion of a module package at all. Every one of
 * its four artefacts was rooted at `backend/src`: the two discovery walks listed
 * `<src>/modules`, `readSourceTree` walked `<src>`, `MODULE_MIGRATION_RE` was
 * anchored at `^modules/<id>/migrations/`, and `specifierFromDb` emitted `./…`
 * or `../…` and nothing else. So the first module to become a package would have
 * vanished from the composer, from the manifest index and — the one that is not
 * recoverable by reading an error message — from the **migration registry**,
 * where an absent entry is a migration that does not run, `migration:pending`
 * reporting nothing pending, and a first symptom that is a query against a table
 * nobody created.
 *
 * ## What a module package is, here
 *
 * A workspace member whose `package.json` declares `endora: { type: 'module',
 * id }` — the package's own statement about itself, the same one
 * `src/packages/installed-packages.ts` reads at boot and the same one
 * `lib/module-roots.ts` keys its package roots on. It is **not** a path: nothing
 * in this file knows or cares that D-141 puts them at `packages/modules/<id>/`,
 * and `pnpm-workspace.yaml` remains the only authority for which directories are
 * members (D-100).
 *
 * A consequence worth stating rather than discovering: a module package the
 * workspace globs do **not** match is not a member and is not discovered here.
 * That is the correct behaviour — the globs are the declaration — but it means
 * moving a module into a directory no glob reaches removes it from every
 * artefact, so the glob and the move belong in one merge request.
 *
 * ## How a file inside one is named
 *
 * By the package's **own `exports` map**, never by a subpath written down here.
 * The rule is *the most specific declared subpath whose target covers the file*,
 * where a target named `index.*` covers its directory recursively and any other
 * target covers exactly itself. So a package declaring
 * `"./migrations": "./src/migrations/index.ts"` has every file under
 * `src/migrations/` named `@scope/mod-<id>/migrations`, and one declaring
 * `"./entities"` instead gets that — both spellings appear in the F4 material
 * (D-149 writes `/entities`, `module-package-layout.md` §2 folds entities into
 * `./backend`), and reading the declaration is how a generator can be right
 * under either without choosing between two documents.
 *
 * A file **no** declared subpath covers is refused, not skipped. It cannot be
 * imported by a committed registry — that is what an `exports` map means — so
 * emitting a specifier for it would produce an artefact that fails at its first
 * import, and skipping it would reproduce the silent-loss failure above.
 * Wildcard subpaths (`"./i18n/*"`) are outside the rule: a deep import through
 * one is the shape `module-package-layout.md` R2 forbids, and it is the one
 * consumer specifier that breaks when full F4 repoints `exports` at `dist`.
 */
import { join, relative, sep } from 'node:path';

import {
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceFs,
} from './workspace-packages.js';

/** One workspace member that declares itself a module. */
export interface ModulePackage {
  /** `endora.id` — the module id, never the directory name (D-142). */
  readonly moduleId: string;
  /** The npm package name; the head of every specifier emitted for it. */
  readonly name: string;
  /** Its directory, absolute. */
  readonly dir: string;
  /** `exports` subpath → target, as declared. Wildcard subpaths are dropped. */
  readonly exports: ReadonlyMap<string, string>;
}

/** Raised when a package cannot be turned into artefact entries. Never skipped. */
export class ModulePackageError extends Error {
  override readonly name = 'ModulePackageError';
}

/** The `endora` block a member declares about itself, if it is a module's. */
function declaredModuleId(manifest: Readonly<Record<string, unknown>>): string | null {
  const endora = manifest['endora'];
  if (typeof endora !== 'object' || endora === null || Array.isArray(endora)) return null;
  const block = endora as Record<string, unknown>;
  if (block['type'] !== 'module') return null;
  const id = block['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The first string target under an `exports` value.
 *
 * A value is either a target string or a conditions object (`{ types, import,
 * default }`). Every condition of one subpath points into the same place in the
 * source tree — that is what a condition *is* — so the first string is enough to
 * answer "which directory does this subpath cover", which is the only question
 * asked of it here.
 */
function targetOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  for (const nested of Object.values(value as Record<string, unknown>)) {
    const found = targetOf(nested);
    if (found !== null) return found;
  }
  return null;
}

/** The declared, non-wildcard subpaths of a manifest's `exports` block. */
export function declaredExports(
  manifest: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string> {
  const block = manifest['exports'];
  const found = new Map<string, string>();
  if (typeof block !== 'object' || block === null || Array.isArray(block)) return found;
  for (const [subpath, value] of Object.entries(block as Record<string, unknown>)) {
    if (subpath.includes('*')) continue;
    const target = targetOf(value);
    if (target === null || !target.startsWith('./')) continue;
    found.set(subpath, target);
  }
  return found;
}

/**
 * Every module package this repository declares, sorted by module id.
 *
 * Unlike `lib/module-roots.ts` this does **not** filter by the registered set:
 * the generator is what *produces* the registered set, so filtering by it would
 * make a newly packaged module invisible to the artefact that is supposed to
 * register it — the instrument reading its own output.
 */
export function discoverModulePackages(
  repoRoot: string,
  fs: WorkspaceFs = nodeWorkspaceFs(),
): readonly ModulePackage[] {
  const found: ModulePackage[] = [];
  for (const member of workspaceMembers(repoRoot, fs)) {
    const moduleId = declaredModuleId(member.manifest);
    if (moduleId === null) continue;
    found.push({
      moduleId,
      name: member.name,
      dir: member.dir,
      exports: declaredExports(member.manifest),
    });
  }
  const byId = new Map<string, ModulePackage>();
  for (const pkg of found) {
    const previous = byId.get(pkg.moduleId);
    if (previous !== undefined) {
      throw new ModulePackageError(
        `[composer] two workspace packages claim module id '${pkg.moduleId}': ` +
          `${previous.name} (${previous.dir}) and ${pkg.name} (${pkg.dir}). One id is one ` +
          `module's tables, settings and permissions; the artefacts cannot register both.`,
      );
    }
    byId.set(pkg.moduleId, pkg);
  }
  return [...byId.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

/** `./src/backend/index.ts` → `src/backend`, recursively; anything else → itself. */
function coveredPathOf(target: string): { path: string; recursive: boolean } {
  const normalised = target.replace(/^\.\//, '');
  const isBarrel = /(^|\/)index\.[cm]?[jt]sx?$/.test(normalised);
  return isBarrel
    ? { path: normalised.replace(/(^|\/)index\.[cm]?[jt]sx?$/, ''), recursive: true }
    : { path: normalised, recursive: false };
}

/**
 * How a committed artefact names one file of a module package (D-149).
 *
 * `packageRelativePath` is the file's path inside the package, `/`-separated.
 * The answer is the **longest** covering target's subpath, so a package that
 * declares both `./backend` and a narrower `./backend/entities` gets the
 * narrower one — the same "most specific wins" rule Node's own resolver applies
 * to an `exports` map.
 */
export function packageSpecifierFor(pkg: ModulePackage, packageRelativePath: string): string {
  let best: { subpath: string; length: number } | null = null;
  for (const [subpath, target] of pkg.exports) {
    if (subpath === './package.json') continue;
    const covered = coveredPathOf(target);
    const matches = covered.recursive
      ? covered.path === '' || packageRelativePath.startsWith(`${covered.path}/`)
      : packageRelativePath === covered.path;
    if (!matches) continue;
    if (best === null || covered.path.length > best.length) {
      best = { subpath, length: covered.path.length };
    }
  }
  if (best === null) {
    const declared = [...pkg.exports.keys()].sort().join(', ') || '(none)';
    throw new ModulePackageError(
      `[composer] ${pkg.name} owns ${packageRelativePath}, and no subpath of its exports map ` +
        `covers it (declared: ${declared}). A committed registry imports it by that ` +
        `specifier, so an uncovered file would be registered under a specifier the package ` +
        `refuses with ERR_PACKAGE_PATH_NOT_EXPORTED — and dropping it instead is how a ` +
        `migration goes missing without a word. Declare a subpath for it, or move the file ` +
        `under one that exists.`,
    );
  }
  return best.subpath === '.' ? pkg.name : `${pkg.name}/${best.subpath.replace(/^\.\//, '')}`;
}

/** A file's path inside its package, `/`-separated. */
export function packageRelativePathOf(pkg: ModulePackage, absolutePath: string): string {
  return relative(pkg.dir, absolutePath).split(sep).join('/');
}

/** The absolute path a package-relative path names. */
export function absolutePathInPackage(pkg: ModulePackage, packageRelativePath: string): string {
  return join(pkg.dir, ...packageRelativePath.split('/'));
}
