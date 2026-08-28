/**
 * "Where does this platform keep its backend modules?" — one derivation, and it
 * answers with a **list** (feature 080, T040a).
 *
 * ## Why a list
 *
 * Wave 1 (issue #215) made every module walk refuse a tree that had moved:
 * `lib/module-population.ts` derives the expected population from the generated
 * manifest index, per module, so a walk that comes back *short* is exit 2
 * rather than `violations=0`. That worked, and
 * `test/unit/scripts/moved-module-tree.test.ts` proves it over sixteen checks.
 *
 * Refusing a moved tree is not the same as **following** one, and the
 * difference decides how F4's layout move can be sequenced. Because the floor
 * is per module, the *first* module that leaves the application's own source
 * tree turns all sixteen checks red: the index still registers it, and no walk
 * produces a file for it. Before this file, the move was therefore one commit
 * or nothing. After it, the walk covers every root a module can live in, the
 * union satisfies the floor at each intermediate state, and modules move one at
 * a time.
 *
 * ## The derivation, and why it is shaped this way
 *
 * Nothing here is a path written down. Three facts are read, in this order,
 * each from the artefact that owns it:
 *
 *   1. **The generated manifest index, by search.** It used to be
 *      `join(srcRoot, 'modules/_lifecycle/manifest-index.generated.ts')`,
 *      which is the module tree's location spelled out inside the derivation that
 *      exists to avoid spelling it. It is now found by walking this
 *      repository's own workspace members for a file of that name — so it is
 *      found where it is today, and equally where the owner's ruling of
 *      2026-08-22 puts it after the move (`backend/src/`, host-owned: the index
 *      is bare core by D-104 and it enumerates *other* packages, and a
 *      publishable package naming all of its siblings is a cycle waiting to be
 *      declared). Two refusals are kept from the shell twin: no index is exit 2,
 *      and more than one index is exit 2 — an ambiguous root silently narrows
 *      every scan to whichever one sorted first.
 *   2. **The application's source root**, as the index's own ancestor that is an
 *      immediate child of the workspace member holding it — `backend/src` under
 *      both layouts above. That is what `src` means here; the name is never
 *      matched.
 *   3. **The roots themselves**, from the registered ids:
 *
 *      * an **application** root is the parent of any directory under the
 *        source root whose name is a registered module id and which holds a
 *        `manifest.ts`. Today that resolves to exactly one, `backend/src/modules`.
 *        A per-deployment overlay tree is *not* one of them — an overlay module
 *        is discovered at runtime and is absent from the bare-core index
 *        (D-104) — so it is carried separately, as {@link ModuleTreeLayout.overlayRoot}.
 *      * a **package** root is a workspace member whose manifest declares
 *        `endora.type === 'module'` with a registered `endora.id`. The
 *        declaration is the package's own statement about itself, the same one
 *        `src/packages/installed-packages.ts` reads at boot, so a module package
 *        is recognised wherever the workspace globs put it and whatever its
 *        directory is called.
 *
 * The package half is deliberately keyed on the **declared id** rather than on
 * a `modules/<id>/` path segment. A path segment would work for
 * `packages/modules/<id>/…` and silently stop working for any other layout,
 * which is the failure this file exists to end rather than to relocate.
 *
 * ## Keys
 *
 * Every check turns an absolute path into a string for a message or a ledger
 * key, and two shapes exist in the tree. Both are preserved exactly:
 * {@link ModuleTreeLayout.keyOf} is `relative(srcRoot, …)` (`modules/blog/x.ts`)
 * and {@link ModuleTreeLayout.displayOf} keeps the application's own prefix
 * (`src/modules/blog/x.ts`). A file that is **not** under the source root — a
 * package's — is keyed relative to the repository root
 * (`packages/modules/blog/src/x.ts`) by both, because there is no application
 * prefix that would be true of it. So on a tree with no module package, every
 * key this file produces is byte-for-byte the one produced before it existed.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  declaredModuleId,
  nodeWorkspaceFs,
  workspaceMembers,
  type WorkspaceFs,
} from './workspace-packages.js';
import {
  loadManifestActivations,
  loadManifestLocations,
  ManifestIndexUnreadableError,
} from './switchable-modules.js';
import { moduleIdOf } from './module-population.js';
import { platformPackageNameOf, platformSourceRootOf } from './platform-root.js';

/** The file the composer generates and every module walk derives its floor from. */
export const MANIFEST_INDEX_FILENAME = 'manifest-index.generated.ts';

/**
 * Directories that are not this repository's own source and would either slow
 * the search to no purpose or answer it with somebody else's copy.
 *
 * The same list the shell twin (`scripts/lib/module-root.sh`) prunes, kept in
 * step with it by `test/unit/scripts/module-roots.test.ts`.
 */
export const PRUNED_DIRECTORIES: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.docusaurus',
];

/** Raised when the module layout cannot be resolved; a caller turns it into exit 2. */
export class ModuleLayoutUnresolvableError extends Error {
  override readonly name = 'ModuleLayoutUnresolvableError';
}

/** One place backend module sources live. */
export interface ModuleSourceRoot {
  /** Absolute directory to walk. */
  readonly directory: string;
  /**
   * The module every file under {@link directory} belongs to, or `null` when
   * the directory holds several and attribution is read from the path.
   */
  readonly moduleId: string | null;
  readonly origin: 'application' | 'workspace-package' | 'host-resident';
}

export interface ModuleTreeLayout {
  /** The checkout, fully resolved. */
  readonly repoRoot: string;
  /** The workspace member holding the manifest index — the application. */
  readonly applicationRoot: string;
  /** Its source root, derived from where the index sits. */
  readonly srcRoot: string;
  /** The generated manifest index, absolute. */
  readonly manifestIndexPath: string;
  /** Module ids that index registers. */
  readonly registeredIds: readonly string[];
  /** Every root holding module sources — application trees first, then packages. */
  readonly moduleRoots: readonly ModuleSourceRoot[];
  /** The per-deployment overlay tree (`<src>/apps`), which the index never lists. */
  readonly overlayRoot: string;
  /**
   * The platform's own source directory, or `null` when this workspace has no
   * member declaring `endora.type: "platform"` (every fixture tree).
   *
   * It is a root of its own because it is not the application's and not a
   * module's: `packages/platform/src/{kernel,http,tenancy,commands,events}` is
   * what `backend/src` reached relatively until the relocation, and what it now
   * reaches through re-export shims. A check whose population *is* the platform
   * refuses on `null` itself.
   */
  readonly platformRoot: string | null;
  /**
   * The npm name that platform publishes under — `null` on the same workspaces
   * {@link ModuleTreeLayout.platformRoot} is `null` on.
   *
   * It is the other half of the same answer (feature 080, T060): a module in the
   * application tree reaches the platform by relative path and a module in a
   * package reaches it by this name, so a check whose population is *module
   * reaches into the platform* needs both spellings or it loses the second set
   * as the sweep converts them.
   */
  readonly platformPackageName: string | null;
  /**
   * Every directory a check that reads the whole application source tree must
   * walk: the source root, the platform's, plus each package root — all three
   * outside one another.
   *
   * The platform is here so that the twelve checks reading this keep the
   * population they had before the relocation. Its five directories were under
   * `src/` and every one of these walks covered them; leaving them out would
   * have dropped six entity classifications from
   * `check-entity-tenant-classification`, four repeating timers from
   * `check:entry-scope` and the whole of `check:kernel-boundary`'s subject —
   * each of which keeps printing a number and exiting 0, which is issue #215.
   */
  readonly sourceRoots: readonly string[];
  /** Every directory a check that reads only module sources must walk. */
  readonly moduleWalkRoots: readonly string[];
  /** `modules/blog/x.ts` for the application, repo-relative for a package. */
  readonly keyOf: (absolutePath: string) => string;
  /** The same, with the application's own prefix: `src/modules/blog/x.ts`. */
  readonly displayOf: (absolutePath: string) => string;
  /**
   * {@link ModuleTreeLayout.keyOf} inverted — the absolute path a key names.
   *
   * The two bases a key can be relative to are tried in the order that keeps
   * the application's own spelling authoritative, because that is the one a
   * ledger and a message already use.
   */
  readonly absolutePathOf: (key: string) => string;
  /** The module a path belongs to, over every root, or `null`. */
  readonly moduleIdOfPath: (absolutePath: string) => string | null;
  /**
   * Every module's own directory, by id — the enumeration half of
   * {@link ModuleTreeLayout.moduleDirectoryOf}.
   *
   * A walk that has to visit *each* module (a bundle sweep, an i18n reconcile)
   * reads this instead of listing a directory, because listing one answers for
   * one root and there is now more than one.
   */
  readonly moduleDirectories: ReadonlyMap<string, string>;
  /**
   * The directory holding a module's own sources, or `null`.
   *
   * For an application root it is `<root>/<id>`; for a package it is the
   * member directory. What it does **not** answer is where inside a package a
   * named file lives — a package declares its entry points in its `exports`
   * map, and reading that is the host package's business (T042a), not this
   * one's. A caller that needs `backend.ts` therefore asks for the directory
   * and looks in the two places a workspace member can keep it.
   */
  readonly moduleDirectoryOf: (moduleId: string) => string | null;
  /**
   * The npm name each module package publishes, mapped to the module id it
   * declares — `@endora-commerce/mod-blog` → `blog`.
   *
   * It exists because a bare specifier can now reach a module, which is a thing
   * this repository had never been able to say. `check-module-boundary`'s
   * predicate 1 resolved relative specifiers only, on the stated premise that
   * "there is no `@endora-commerce/mod-*` package yet"; !910 falsified that
   * premise and the premise stayed. `blog` shipped with no ledger shard, so the
   * hole cost nothing and showed nothing.
   *
   * The direction is name → id, and it is the only direction that is safe to
   * key a ledger on (D-142): the npm name is npm's namespace, the manifest id is
   * identity of record, and an edge that was `../blog/entities/blog-post.entity`
   * before the move has to stay one key after it. Nothing here reads the name's
   * spelling — a `mod-` prefix rule would be a derived fact written down (D-100)
   * and would answer wrongly for the first package that is not named that way.
   */
  readonly modulePackageNames: ReadonlyMap<string, string>;
  /**
   * The directories of every **host-resident** module, keyed as
   * {@link ModuleTreeLayout.keyOf} keys them, mapped to the module id.
   *
   * It is what a check hands to `moduleIdOf` / `moduleOf` so that its analysis
   * attributes those files to their module. Empty on a tree that has none, in
   * which case every attributor answers exactly as it did before this existed.
   */
  readonly hostResidentModules: ReadonlyMap<string, string>;
}

function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/** Every file of that name under `dir`, with {@link PRUNED_DIRECTORIES} skipped. */
function findByName(dir: string, filename: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let directory: boolean;
    try {
      directory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (directory) {
      if (PRUNED_DIRECTORIES.includes(entry)) continue;
      findByName(full, filename, out);
      continue;
    }
    if (entry === filename) out.push(full);
  }
  return out;
}

/**
 * The nearest ancestor of `from` that declares a pnpm workspace.
 *
 * Nearest, so a worktree parked *inside* the main tree — which is where this
 * repository's agents work — answers with itself rather than with its host.
 * This is the same judgement `scripts/workspace-resolution.ts` makes, and the
 * shell twin makes it through the `.git` marker instead, because a sourced
 * library cannot assume a node toolchain.
 */
export function findRepoRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The one manifest index this repository owns.
 *
 * Searched over the workspace members rather than under a named source root: a
 * search rooted at `backend/src` would answer "gone" for an index that merely
 * moved one level up, which is the event this whole file exists for.
 */
export function findManifestIndex(
  repoRoot: string,
  fs: WorkspaceFs = nodeWorkspaceFs(),
): string {
  const members = workspaceMembers(repoRoot, fs);
  if (members.length === 0) {
    throw new ModuleLayoutUnresolvableError(
      `${join(repoRoot, 'pnpm-workspace.yaml')} declares no workspace member — the module ` +
        'roots are derived from them, so there is nothing to search',
    );
  }
  const found = new Set<string>();
  for (const member of members) {
    for (const hit of findByName(member.dir, MANIFEST_INDEX_FILENAME)) found.add(hit);
  }
  const indexes = [...found].sort();
  if (indexes.length === 0) {
    throw new ModuleLayoutUnresolvableError(
      `no ${MANIFEST_INDEX_FILENAME} under any workspace member of ${repoRoot} — the module ` +
        'tree is not where anything can find it',
    );
  }
  if (indexes.length > 1) {
    throw new ModuleLayoutUnresolvableError(
      `more than one ${MANIFEST_INDEX_FILENAME} under the workspace members of ${repoRoot}:\n` +
        `${indexes.map((path) => `  ${path}`).join('\n')}\n` +
        'the module root is ambiguous, and picking one narrows every scan to it without ' +
        'saying so',
    );
  }
  return indexes[0]!;
}

/**
 * The application's source root: the index's ancestor that is an immediate
 * child of the workspace member holding it.
 *
 * `backend/src/modules/_lifecycle/<index>` and `backend/src/<index>` both
 * answer `backend/src`, which is what makes the owner's ruling about where the
 * index lives a change this derivation does not have to be told about.
 */
export function sourceRootOfIndex(indexPath: string, memberDir: string): string {
  let cursor = dirname(indexPath);
  for (;;) {
    const parent = dirname(cursor);
    if (parent === cursor) return cursor;
    if (parent === memberDir) return cursor;
    cursor = parent;
  }
}

/**
 * Application module roots: the parents of registered-id directories that hold
 * a `manifest.ts`.
 *
 * Both halves of that predicate are load-bearing. The id filter is what keeps
 * an overlay tree (`src/apps/<deployment>/modules/<id>`) and the test
 * fixtures' module-shaped directories out — neither is in the bare-core index.
 * The `manifest.ts` filter is what keeps a directory that merely shares a
 * module's name out: `test/unit/orders` is not a module root's child, and a
 * derivation that took the name alone would say it was.
 */
export function applicationModuleRoots(
  srcRoot: string,
  registered: ReadonlySet<string>,
): readonly string[] {
  const roots = new Set<string>();
  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PRUNED_DIRECTORIES.includes(entry)) continue;
      const full = join(dir, entry);
      let directory: boolean;
      try {
        directory = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!directory) continue;
      if (registered.has(entry) && existsSync(join(full, 'manifest.ts'))) {
        roots.add(dir);
        continue;
      }
      visit(full);
    }
  };
  visit(srcRoot);
  return [...roots].sort();
}

/**
 * The module roots the two derivations above cannot see: a module whose sources
 * the **host application** owns (feature 080, T040b).
 *
 * There is one, `_lifecycle`, and it is one by D-160.11 — the lifecycle
 * subsystem is the platform's operator half, so it never became a package the
 * way the other 66 modules did. It is still a registered module with a
 * manifest, permissions, an activation declaration and its own i18n bundles, so
 * every module walk has to keep reading it; what changed is only where its
 * directory sits.
 *
 * It cannot be found the way {@link applicationModuleRoots} finds a module,
 * because that predicate is *"a directory named after a registered id"* and
 * this directory is deliberately **not**: a `src/_lifecycle/` would make
 * `backend/src` itself a module root, and every kernel, `db/` and `http/` file
 * under it a module's source with no module to attribute it to. So it is read
 * from the index's own `manifestPath` — the artefact that already records where
 * each module's manifest is, for all three origins — and a module whose
 * manifest sits under the application source root but is not an immediate child
 * of a module root is one of these.
 *
 * Nothing is written down and the derivation fails closed in both directions
 * (D-100, issue #215). A module whose directory disappeared cannot arrive here
 * as "host-resident": its manifest specifier would resolve to nothing and the
 * index would not import at all, which is exit 2 at the reader. And a candidate
 * that is the source root itself, or an ancestor of a root already found, is
 * refused rather than walked — a root that swallows the tree reports every file
 * in it as one module's.
 */
export function hostResidentModuleRoots(
  srcRoot: string,
  found: readonly ModuleSourceRoot[],
  manifestPaths: ReadonlyMap<string, string>,
): ModuleSourceRoot[] {
  const roots: ModuleSourceRoot[] = [];
  for (const [moduleId, manifestPath] of manifestPaths) {
    const directory = dirname(resolve(manifestPath));
    if (!isUnder(directory, srcRoot) || directory === srcRoot) continue;
    if (found.some((root) => isUnder(directory, root.directory))) continue;
    if (found.some((root) => isUnder(root.directory, directory))) continue;
    roots.push({ directory, moduleId, origin: 'host-resident' });
  }
  return roots.sort((a, b) => a.directory.localeCompare(b.directory));
}

/**
 * The whole layout, resolved once.
 *
 * Async because the registered ids come out of the generated index, which is a
 * TypeScript module the checks import rather than a file they parse — the same
 * reader `lib/switchable-modules.ts` uses, so the two derivations cannot
 * disagree about which modules exist.
 */
export async function resolveModuleLayout(
  from: string = process.cwd(),
  fs: WorkspaceFs = nodeWorkspaceFs(),
): Promise<ModuleTreeLayout> {
  const repoRoot = findRepoRoot(from);
  if (repoRoot === null) {
    throw new ModuleLayoutUnresolvableError(
      `no pnpm-workspace.yaml at or above ${resolve(from)} — this is not a checkout of a ` +
        'workspace whose module roots can be derived',
    );
  }
  const members = workspaceMembers(repoRoot, fs);
  const manifestIndexPath = findManifestIndex(repoRoot, fs);
  const applicationMember = members.find((member) => isUnder(manifestIndexPath, member.dir));
  if (applicationMember === undefined) {
    throw new ModuleLayoutUnresolvableError(
      `${manifestIndexPath} is under no workspace member of ${repoRoot}`,
    );
  }
  const srcRoot = sourceRootOfIndex(manifestIndexPath, applicationMember.dir);
  const registeredIds = (await loadManifestActivations(manifestIndexPath)).map(
    (manifest) => manifest.id,
  );
  const registered = new Set(registeredIds);

  const moduleRoots: ModuleSourceRoot[] = applicationModuleRoots(srcRoot, registered).map(
    (directory) => ({ directory, moduleId: null, origin: 'application' as const }),
  );
  const modulePackageNames = new Map<string, string>();
  for (const member of members) {
    const declared = declaredModuleId(member);
    if (declared === null || !registered.has(declared)) continue;
    moduleRoots.push({
      directory: member.dir,
      moduleId: declared,
      origin: 'workspace-package',
    });
    modulePackageNames.set(member.name, declared);
  }

  for (const root of hostResidentModuleRoots(srcRoot, moduleRoots, await loadManifestLocations(manifestIndexPath))) {
    moduleRoots.push(root);
  }

  const overlayRoot = join(srcRoot, 'apps');
  const packageRoots = moduleRoots
    .filter((root) => root.origin === 'workspace-package')
    .map((root) => root.directory);
  const platformRoot = platformSourceRootOf(members);
  const platformPackageName = platformPackageNameOf(members);

  const keyOf = (absolutePath: string): string => {
    const path = resolve(absolutePath);
    const base = isUnder(path, srcRoot) ? srcRoot : repoRoot;
    return relative(base, path).split('\\').join('/');
  };
  const displayOf = (absolutePath: string): string => {
    const path = resolve(absolutePath);
    const base = isUnder(path, srcRoot) ? applicationMember.dir : repoRoot;
    return relative(base, path).split('\\').join('/');
  };
  const absolutePathOf = (key: string): string => {
    const withinApplication = join(srcRoot, key);
    return existsSync(withinApplication) ? withinApplication : join(repoRoot, key);
  };
  const moduleIdOfPath = (absolutePath: string): string | null => {
    const path = resolve(absolutePath);
    for (const root of moduleRoots) {
      if (root.moduleId !== null && isUnder(path, root.directory)) return root.moduleId;
    }
    return moduleIdOf(keyOf(path));
  };

  const moduleDirectories = new Map<string, string>();
  for (const root of moduleRoots) {
    if (root.moduleId !== null) {
      moduleDirectories.set(root.moduleId, root.directory);
      continue;
    }
    for (const id of registeredIds) {
      const candidate = join(root.directory, id);
      if (!moduleDirectories.has(id) && existsSync(candidate)) moduleDirectories.set(id, candidate);
    }
  }
  const moduleDirectoryOf = (moduleId: string): string | null =>
    moduleDirectories.get(moduleId) ?? null;

  return {
    repoRoot,
    applicationRoot: applicationMember.dir,
    srcRoot,
    manifestIndexPath,
    registeredIds,
    moduleRoots,
    overlayRoot,
    platformRoot,
    platformPackageName,
    sourceRoots: platformRoot === null ? [srcRoot, ...packageRoots] : [srcRoot, platformRoot, ...packageRoots],
    moduleWalkRoots: [
      ...moduleRoots
        .filter((root) => root.origin === 'application' || root.origin === 'host-resident')
        .map((root) => root.directory),
      overlayRoot,
      ...packageRoots,
    ],
    keyOf,
    displayOf,
    absolutePathOf,
    moduleIdOfPath,
    moduleDirectories,
    moduleDirectoryOf,
    modulePackageNames,
    hostResidentModules: new Map(
      moduleRoots
        .filter((root) => root.origin === 'host-resident' && root.moduleId !== null)
        .map((root) => [keyOf(root.directory), root.moduleId!] as const),
    ),
  };
}

/**
 * The CLI half: resolve the layout, or print the refusal and exit 2.
 *
 * One function rather than a copy per check, for the reason
 * `refuseVacuousModulePopulation` is one function: a copy per check is a chance
 * per check to write the one that returns instead of exiting, and a check whose
 * guard is subtly wrong is invisible by construction.
 */
export async function requireModuleLayout(prefix: string): Promise<ModuleTreeLayout> {
  try {
    return await resolveModuleLayout();
  } catch (error: unknown) {
    const detail =
      error instanceof ModuleLayoutUnresolvableError || error instanceof ManifestIndexUnreadableError
        ? error.message
        : String(error);
    console.error(
      `${prefix} the module layout could not be resolved (${detail}) — every root this ` +
        'check walks and the population it reconciles them against are derived from it; ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }
}

/**
 * Does this source file compose a module — i.e. is it the module's entry point?
 *
 * **The marker, never a filename** (feature 080, T040b). A module in the
 * application's tree keeps `registerModule` in `backend.ts`; a module package
 * keeps it wherever its `exports` map's `./backend` subpath leads, which for
 * both packages in this repository is `src/backend/index.ts`. A predicate
 * spelled as a filename therefore answers `false` for a packaged module, and
 * the answer is not merely incomplete — it is fail-*open* at the place it is
 * asked. `check-port-dependencies` matched `'/backend.ts'` and so could not see
 * a packaged module's `di.providePort` calls: every consumer of one of those
 * ports read as *resolving an ungated registration*, and was told to write an
 * absent-owner policy for a gate that was right there. `blog` hid it by owning
 * no port another module resolves; `quote_requests` owns two, resolved by six
 * modules, and reported six findings the moment it moved.
 *
 * One expression, shared by `generate-composer.ts` — which locates a module's
 * entry point this way for both origins — and by every check that needs the
 * same file. A check whose decision exists in two places can go half-missing
 * without either red proof noticing.
 *
 * It reads the **export**, not an import or a call, so a file that merely
 * mentions `registerModule` is not one; and it does not follow a re-export, so
 * a barrel that forwards `registerModule` from a neighbour is not recognised
 * here. The composer refuses a package with zero or two such files with a
 * message that says so, which is where that shape is caught.
 */
export function declaresRegisterModule(source: string): boolean {
  return /export\s+(?:function|const|let|async\s+function)\s+registerModule\b/.test(source);
}
