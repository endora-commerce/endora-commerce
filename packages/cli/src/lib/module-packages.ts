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
 *
 * ## The file the generator walked is not the file the subpath serves
 *
 * The paragraph above was written when D-140 ruled that a module package ships
 * **source**, so an `exports` target named a `.ts` file the walk had just read
 * and the two were the same path. **D-164 supersedes D-140**: a module package
 * ships `dist`, because `tsx` applies one tsconfig per process and lowers a
 * decorated file outside it with standard semantics, which kills every MikroORM
 * entity a source package carries. So the map now names `./dist/backend/index.js`
 * while the walk produces `src/backend/entities/blog-post.entity.ts`, and
 * matching one against the other refuses **every** file of a package that
 * follows the ruling — measured, before this paragraph existed: all four of
 * `blog`'s shapes raised "no subpath of its exports map covers it".
 *
 * The missing step is the package's own **build declaration**, and it is read
 * rather than assumed: `tsconfig.build.json`, following a relative `extends`
 * exactly as `check-release-intent.ts` does, for its `rootDir` and `outDir`.
 * A source file under `rootDir` is emitted at the same relative position under
 * `outDir` with a `.js` extension, and *that* is the path matched against the
 * `exports` targets. A package with **no** build configuration publishes what
 * the walk read, so its paths match unchanged — which is what keeps the
 * source-shipping regime working and is why this is a mapping rather than a
 * `dist/` prefix written into the matcher.
 *
 * A `tsconfig.build.json` that exists and cannot be read or parsed is a
 * **refusal**, never a fall back to "then it ships source": that reading would
 * emit specifiers naming `.ts` files inside a package that publishes `.js`, and
 * every one of them would fail at the artefact's first import.
 */
import { realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

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
  /**
   * Where this package's build puts the sources the walk reads, or `null` when
   * it declares no build and therefore publishes them where they are.
   *
   * Both paths are package-relative and `/`-separated, with no trailing slash.
   */
  readonly emit: EmitLayout | null;
}

/** `tsconfig.build.json`'s `rootDir` and `outDir`, package-relative. */
export interface EmitLayout {
  readonly rootDir: string;
  readonly outDir: string;
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

/** `packages/modules/blog/src` → `src`; `./dist/` → `dist`; `.` → `''`. */
function normaliseRelativeDirectory(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').replace(/^\.$/, '');
}

/**
 * `tsconfig.build.json`'s emit layout for one package, or `null` when it has no
 * build configuration at all.
 *
 * Follows a relative `extends` for the same reason `check-release-intent.ts`
 * does: !891's two-config split puts `rootDir` in the build file and everything
 * else in the file it extends, so a reader of one alone finds half an answer.
 * The **nearest** declaration of each key wins, which is what `tsc` itself does.
 *
 * A non-relative `extends` (`"@scope/tsconfig/base"`) is a refusal rather than a
 * stop: this repository has none, and treating one as "no more to read" would
 * silently answer with whatever half of the layout had been found so far.
 */
export function readEmitLayout(
  packageDir: string,
  packageName: string,
  fs: WorkspaceFs,
): EmitLayout | null {
  const seen = new Set<string>();
  let current = join(packageDir, 'tsconfig.build.json');
  let rootDir: string | null = null;
  let outDir: string | null = null;

  while (rootDir === null || outDir === null) {
    if (seen.has(current)) {
      throw new ModulePackageError(
        `[composer] ${packageName}: ${current} is part of an \`extends\` cycle, so where its ` +
          `sources are emitted cannot be read.`,
      );
    }
    seen.add(current);
    const text = fs.readText(current);
    if (text === null) {
      // Only the first hop may be absent: a package with no build configuration
      // publishes its sources where they are. A missing file *inside* an
      // `extends` chain is a broken configuration and is refused below.
      if (seen.size === 1) return null;
      throw new ModulePackageError(
        `[composer] ${packageName}: ${current} is named by an \`extends\` and could not be ` +
          `read, so where its sources are emitted is unknown. A committed registry names ` +
          `those emitted files by specifier; guessing one produces an artefact that fails ` +
          `at its first import.`,
      );
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(stripLineComments(text)) as Record<string, unknown>;
    } catch (error: unknown) {
      throw new ModulePackageError(
        `[composer] ${packageName}: ${current} does not parse (${String(error)}), so where ` +
          `its sources are emitted is unknown.`,
      );
    }
    const options = (config['compilerOptions'] ?? {}) as Record<string, unknown>;
    if (rootDir === null && typeof options['rootDir'] === 'string') {
      rootDir = normaliseRelativeDirectory(options['rootDir']);
    }
    if (outDir === null && typeof options['outDir'] === 'string') {
      outDir = normaliseRelativeDirectory(options['outDir']);
    }
    const parent = config['extends'];
    if (parent === undefined) break;
    if (typeof parent !== 'string' || !parent.startsWith('.')) {
      throw new ModulePackageError(
        `[composer] ${packageName}: ${current} extends '${String(parent)}', which is not a ` +
          `relative path — this derivation cannot follow it, and stopping here would answer ` +
          `with half of the emit layout.`,
      );
    }
    current = join(current, '..', parent);
  }

  if (rootDir === null || outDir === null) {
    throw new ModulePackageError(
      `[composer] ${packageName}: ${join(packageDir, 'tsconfig.build.json')} and its ` +
        `\`extends\` chain declare ${rootDir === null ? '`rootDir`' : '`outDir`'} nowhere. A ` +
        `package that emits needs both, because the specifier a committed registry carries ` +
        `names the emitted file and not the source the walk read.`,
    );
  }
  return { rootDir, outDir };
}

/** A tsconfig is JSON with comments; the same stripper the other readers use. */
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

/**
 * Where a source file the walk read ends up in the published artefact.
 *
 * Package-relative in, package-relative out. Without a build layout the answer
 * is the input — a source-shipping package publishes what was walked. With one,
 * a file under `rootDir` moves to the same position under `outDir` and its
 * TypeScript extension becomes the emitted `.js`; a file **outside** `rootDir`
 * is returned unchanged, so it goes on to fail the `exports` match with the
 * message that names the file, rather than being silently relocated to a path
 * the build never writes.
 */
export function emittedPathOf(pkg: ModulePackage, packageRelativePath: string): string {
  if (pkg.emit === null) return packageRelativePath;
  const prefix = pkg.emit.rootDir === '' ? '' : `${pkg.emit.rootDir}/`;
  if (prefix !== '' && !packageRelativePath.startsWith(prefix)) return packageRelativePath;
  const withinRoot = packageRelativePath.slice(prefix.length);
  const emitted = withinRoot
    .replace(/\.mts$/, '.mjs')
    .replace(/\.cts$/, '.cjs')
    .replace(/\.tsx?$/, '.js');
  return pkg.emit.outDir === '' ? emitted : `${pkg.emit.outDir}/${emitted}`;
}

/**
 * The **runtime** string target under an `exports` value.
 *
 * A value is either a target string or a conditions object (`{ types, import,
 * default }`). This used to take the first string it found, on the ground that
 * "every condition of one subpath points into the same place in the source
 * tree". That holds for a *directory* and not for a *file*, which is the
 * granularity actually used: `{ types: './dist/backend/index.d.ts', default:
 * './dist/backend/index.js' }` — the shape every package in this repository
 * writes since !876 — answered `index.d.ts`, which is neither the file the
 * registry imports nor a name the "a barrel covers its directory" rule
 * recognises, so `./backend` covered nothing at all.
 *
 * `types` is therefore skipped while any other condition is present. It is the
 * one condition that deliberately names a *different* file from the rest, and
 * the question asked here — which subpath serves the file a committed artefact
 * imports — is a runtime question.
 */
function targetOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const conditions = Object.entries(value as Record<string, unknown>);
  for (const [condition, nested] of conditions) {
    if (condition === 'types') continue;
    const found = targetOf(nested);
    if (found !== null) return found;
  }
  // Types-only is legal and is still an answer, if a narrower one.
  for (const [, nested] of conditions) {
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
      emit: readEmitLayout(member.dir, member.name, fs),
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
  const published = emittedPathOf(pkg, packageRelativePath);
  let best: { subpath: string; length: number } | null = null;
  for (const [subpath, target] of pkg.exports) {
    if (subpath === './package.json') continue;
    const covered = coveredPathOf(target);
    const matches = covered.recursive
      ? covered.path === '' || published.startsWith(`${covered.path}/`)
      : published === covered.path;
    if (!matches) continue;
    if (best === null || covered.path.length > best.length) {
      best = { subpath, length: covered.path.length };
    }
  }
  if (best === null) {
    const declared = [...pkg.exports.keys()].sort().join(', ') || '(none)';
    const via = published === packageRelativePath ? '' : `, published at ${published}`;
    throw new ModulePackageError(
      `[composer] ${pkg.name} owns ${packageRelativePath}${via}, and no subpath of its exports ` +
        `map covers it (declared: ${declared}). A committed registry imports it by that ` +
        `specifier, so an uncovered file would be registered under a specifier the package ` +
        `refuses with ERR_PACKAGE_PATH_NOT_EXPORTED — and dropping it instead is how a ` +
        `migration goes missing without a word. Declare a subpath for it, or move the file ` +
        `under one that exists.`,
    );
  }
  return best.subpath === '.' ? pkg.name : `${pkg.name}/${best.subpath.replace(/^\.\//, '')}`;
}

/**
 * Is this source file the one a declared subpath points **at** — a barrel?
 *
 * `module-package-layout.md` §1 puts a module package's migrations under
 * `src/migrations/`, and the `./migrations` subpath has to name a file, so the
 * directory holds one that is not a migration: the barrel re-exporting the
 * classes, which is what makes `import { Migration… } from
 * '<pkg>/migrations'` resolve. `collectMigrations` refuses an unrecognised
 * `.ts` in a migrations directory — correctly, because skipping one is how a
 * migration goes missing without a word — so it needs to tell the barrel from
 * a misnamed migration.
 *
 * It is answered from the **package's own `exports` map** rather than from
 * `contracts/naming-convention.md` §4's allow-list, which is keyed on
 * application paths and would have to grow an entry per package. A file a
 * subpath points at is an entry point by declaration; a file that merely sits
 * beside it is not.
 */
export function isDeclaredEntryPoint(pkg: ModulePackage, packageRelativePath: string): boolean {
  const published = emittedPathOf(pkg, packageRelativePath);
  for (const [subpath, target] of pkg.exports) {
    if (subpath === './package.json') continue;
    if (target.replace(/^\.\//, '') === published) return true;
  }
  return false;
}

/** A file's path inside its package, `/`-separated. */
export function packageRelativePathOf(pkg: ModulePackage, absolutePath: string): string {
  return relative(pkg.dir, absolutePath).split(sep).join('/');
}

/** The absolute path a package-relative path names. */
export function absolutePathInPackage(pkg: ModulePackage, packageRelativePath: string): string {
  return join(pkg.dir, ...packageRelativePath.split('/'));
}

// ── the other population: an instance's installed packages ──────────────────
//
// `specs/110-instance-repository/` FR-005 and `contracts/instance-repository.md`
// R3.5. Everything above answers "which of **this repository's** workspace
// members is a module"; a client's instance holds no workspace member and no
// module source at all (D-207), so the same question there is "which packages
// did this instance **install**".
//
// It is the same derivation with a different population, deliberately: the
// `exports` map, the emit layout and {@link packageSpecifierFor} are shared,
// because R3.5 asks for one generator and a second implementation of "how does
// an artefact name a file inside a package" is two answers waiting to disagree
// about a client's admin bundle.
//
// ## Its runtime twin, and why this is not that file
//
// `backend/src/packages/installed-packages.ts` asks the same question **at
// boot**, and the two agree on the three rules that decide an answer: a package
// declares itself with `endora: { type: 'module', id }`; only the top level of a
// `node_modules` is enumerated; and a candidate whose real path leaves the
// `node_modules` it was reached through is **not** an installed package. They
// are separate because they run in different processes for different reasons —
// that one composes a platform, this one renders a build artefact before any
// platform exists — and because the platform publishes no subpath a build-time
// tool could reach it through (`specs/110-instance-repository/` T111 is where
// that changes). When it does, this walk is the caller that should stop having
// its own copy of the three rules.

/** The filesystem questions the installed walk asks beyond {@link WorkspaceFs}. */
export interface InstanceFs extends WorkspaceFs {
  /**
   * The real path of a directory, or `null` when it cannot be resolved.
   *
   * Required rather than optional: without it the linked-package rule below
   * cannot be decided, and a walk that cannot decide it would report a
   * workspace link as an installed package — the one shape whose consequence is
   * an admin bundle naming a module the backend never composed.
   */
  readonly realPath: (path: string) => string | null;
}

/** The real filesystem behind {@link InstanceFs}. Absence is `null`, never a throw. */
export function nodeInstanceFs(): InstanceFs {
  const base = nodeWorkspaceFs();
  return {
    ...base,
    realPath(path: string): string | null {
      try {
        return realpathSync(path);
      } catch {
        return null;
      }
    },
  };
}

/** A candidate the installed walk read and did not accept, with the reason. */
export type SkippedInstalledPackage =
  | {
      /**
       * A **linked** package — `link:`, `file:`, or a pnpm workspace member —
       * whose real directory is outside the `node_modules` it was reached
       * through.
       *
       * It is excluded rather than refused because the running platform excludes
       * it too, and for the same reason: the two must agree about which modules
       * an instance has. An artefact naming it would put a screen in the admin
       * bundle for a module the backend never composes.
       * `specs/110-instance-repository/contracts/instance-repository.md` §8 is
       * what a client does instead.
       */
      readonly kind: 'links-out-of-node-modules';
      readonly name: string;
      readonly at: string;
      readonly realPath: string;
    }
  | { readonly kind: 'unreadable'; readonly at: string; readonly reason: string };

/** What one walk of an instance's `node_modules` found. */
export interface InstalledModulePackageScan {
  /** Accepted packages, sorted by module id — the same order the workspace walk uses. */
  readonly packages: readonly ModulePackage[];
  /** Candidates that claimed to be modules and were not taken, each with a reason. */
  readonly skipped: readonly SkippedInstalledPackage[];
  /** The `node_modules` root that was read. Empty when there is none. */
  readonly root: string | null;
}

/** Top-level candidate directories in one `node_modules`, `@scope/` expanded. */
function installedCandidates(root: string, fs: WorkspaceFs): readonly string[] {
  const found: string[] = [];
  for (const name of [...fs.listDirectories(root)].sort()) {
    // `.pnpm`, `.bin`: the store is reached through the top-level link, so
    // descending would find every package a second time.
    if (name.startsWith('.')) continue;
    const full = join(root, name);
    if (!name.startsWith('@')) {
      found.push(full);
      continue;
    }
    for (const inner of [...fs.listDirectories(full)].sort()) {
      if (inner.startsWith('.')) continue;
      found.push(join(full, inner));
    }
  }
  return found;
}

/**
 * Every module package an instance installed, with what was skipped and why.
 *
 * `instanceRoot` is the directory whose `node_modules` holds them — the client's
 * repository root. A root with no `node_modules` reads as *nothing to read*
 * (`root: null`) rather than as *no module installed*, so a caller can tell an
 * uninstalled instance from a module-less one.
 */
export function scanInstalledModulePackages(
  instanceRoot: string,
  fs: InstanceFs = nodeInstanceFs(),
): InstalledModulePackageScan {
  const root = join(instanceRoot, 'node_modules');
  const realRoot = fs.realPath(root);
  if (realRoot === null) return { packages: [], skipped: [], root: null };

  const skipped: SkippedInstalledPackage[] = [];
  const byId = new Map<string, ModulePackage>();
  for (const directory of installedCandidates(root, fs)) {
    const manifestPath = join(directory, 'package.json');
    const text = fs.readText(manifestPath);
    if (text === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      // Reported, never thrown: one unreadable stranger in a `node_modules`
      // must not stop a client's build, exactly as it must not stop their boot.
      skipped.push({ kind: 'unreadable', at: manifestPath, reason: String(error) });
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const manifest = parsed as Record<string, unknown>;
    const moduleId = declaredModuleId(manifest);
    if (moduleId === null) continue;
    const name = typeof manifest['name'] === 'string' ? manifest['name'] : basename(directory);

    const real = fs.realPath(directory);
    if (real === null) {
      skipped.push({
        kind: 'unreadable',
        at: directory,
        reason: 'its real path could not be resolved, so whether it is installed here or ' +
          'linked from somewhere else cannot be decided',
      });
      continue;
    }
    if (!isUnderDirectory(real, realRoot)) {
      skipped.push({ kind: 'links-out-of-node-modules', name, at: directory, realPath: real });
      continue;
    }

    const pkg: ModulePackage = {
      moduleId,
      name,
      dir: directory,
      exports: declaredExports(manifest),
      emit: readEmitLayout(directory, name, fs),
    };
    const previous = byId.get(moduleId);
    if (previous !== undefined) {
      throw new ModulePackageError(
        `[composer] two installed packages claim module id '${moduleId}': ${previous.name} ` +
          `(${previous.dir}) and ${pkg.name} (${pkg.dir}). One id is one module's tables, ` +
          `settings and permissions; the artefacts cannot register both.`,
      );
    }
    byId.set(moduleId, pkg);
  }
  return {
    packages: [...byId.values()].sort((a, b) => a.moduleId.localeCompare(b.moduleId)),
    skipped,
    root,
  };
}

/** {@link scanInstalledModulePackages}' accepted half. */
export function installedModulePackages(
  instanceRoot: string,
  fs: InstanceFs = nodeInstanceFs(),
): readonly ModulePackage[] {
  return scanInstalledModulePackages(instanceRoot, fs).packages;
}

/** `true` when `child` is inside `parent` and is not `parent` itself. */
function isUnderDirectory(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
