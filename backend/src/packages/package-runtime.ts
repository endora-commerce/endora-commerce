// Installed extension packages — the composition half (feature 080, T031).
//
// `loadPackageModuleEntries` is the sibling of `loadOverlayModuleEntries`
// (`src/overlay/overlay-runtime.ts`) and the second caller of the seam !716
// built: a composition root appends what it returns to the one
// `composeModules([...MODULES, ...overlay, ...packages], …)` call, so an
// installed package receives an ordinary `ModuleContext` and reaches every seam
// a core module reaches. There is no second registration pass, no second
// contribution window and no second `runBootHooks()` (D-45).
//
// **Discovered at runtime, and the committed registries stay bare core**
// (D-119, confirmed as D-155). D-104's predicate decides it, and it yields
// three consistent answers rather than two: an artefact is committed when its
// content is a fact about *the tree*, and resolved at runtime when it is a fact
// about *the process*. A workspace-member module package is a fact about the
// tree (D-149). Which deployment a process is, is a fact about the process
// (D-104). Which packages are installed in an instance's `node_modules` is a
// fact about the process too — so it is discovered here, and
// `composition.generated.ts`, `manifest-index.generated.ts` and both `db/`
// registries stay a walk of the shared core tree.
//
// What discovery can and cannot see is written out in `installed-packages.ts`;
// read that header before assuming this finds a linked directory (it does not).
//
// ## Two things it deliberately does not do
//
//  1. **It does not mark a package `overlay: true`.** That flag exempts a
//     module from the rule that it may decorate only what it registered (issue
//     #203), and an overlay module earns it from the root it was found under:
//     the deployment authored the module and owns the decision. A package is a
//     third party. **D-156 rules it**, and the answer is the one this file
//     ships: a package's `ctx.di.decorate` over a registration it does not own
//     is refused like any core module's. The load-bearing half of that ruling
//     is about the mechanism — `ModuleEntry.overlay` is a per-module boolean
//     and the condition it feeds is name-unscoped, so setting it from an
//     instance's declaration would hand a stranger `commandBus` and
//     `auditLogService` along with whatever it asked for. Any future grant is
//     keyed by (package, registration name) and refused outright for a name no
//     module owns; it is never this flag.
//  2. **It reads a package's schema; it does not configure one.** T033 added
//     `packageSchemaContributionsUnder` at the bottom of this file: it resolves
//     `./migrations` and `./backend` and reads them into registry entries and
//     entity classes. Merging those into the execution order and into the ORM
//     configuration is `src/db/configured-migrations.ts` and
//     `src/db/configured-entities.ts` — so the merge has exactly one
//     implementation, and this file still knows nothing about a database.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModuleManifest, ModuleManifestExports } from '@endora-commerce/contracts';
import type { ModuleEntry } from '../kernel/compose.js';
import type { MigrationRegistryEntry } from '../db/migration-order.js';
import {
  nodeModulesRootsFor,
  scanNodeModulesRoots,
  type InstalledPackage,
  type InstalledPackageScan,
} from './installed-packages.js';
import { assertNoModuleIdCollisions, type ModuleIdClaim } from './module-id-claims.js';

/** An installed package's manifest plus where on disk it came from. */
export interface PackageModuleManifest {
  id: string;
  manifest: ModuleManifest;
  /**
   * The resolved `package.json`.
   *
   * `dirname(filePath)` is how the i18n reconciler and the lifecycle
   * orchestrator locate a module's assets, so this has to be a path *inside*
   * the package directory. For a core module the anchor is `manifest.ts`; for a
   * package it is the `package.json` that claimed the id — a file that
   * genuinely exists in the published artefact, which the compiled root export
   * (`dist/manifest.js`, whose directory holds no `i18n/`) does not give.
   */
  filePath: string;
  /** The npm package name, for diagnostics. Never the platform's identity. */
  packageName: string;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
  /**
   * This module's interest in every *other* module's install and hard
   * uninstall — feature 080, T036a / D-159. Read here for the same reason the
   * two hooks are: the export travels with the manifest, so an overlay module
   * and an installed package declare one on exactly core's terms.
   */
  lifecycleParticipant?: ModuleManifestExports['lifecycleParticipant'];
  /**
   * The operator commands this module declares — feature 080, T042b / D-160.9.
   *
   * This is the origin the shape was designed for: a file under `node_modules`
   * can name no specifier that resolves to the instance's
   * `backend/src/composition.ts`, so a package's CLI can only ever be a
   * declaration the host invokes. Read here on exactly core's terms.
   */
  cliCommands?: ModuleManifestExports['cliCommands'];
  /**
   * The module's recent-activity eligibility — feature 080, T042j / D-163.1.
   *
   * The declaration axis of D-163.1, and the reason it is a manifest export:
   * the four host-owned action tables it replaced were closed lists of core
   * module ids, so a package's audit row was silently absent from the dashboard
   * card rather than refused. Read here on exactly core's terms.
   */
  recentActivity?: ModuleManifestExports['recentActivity'];
}

/**
 * The scan, memoised per root list.
 *
 * An instance's `node_modules` does not change while the platform runs, and
 * both `resolvedManifestEntries()` and `loadPackageModuleEntries()` ask the
 * same question during one boot. Keyed by the roots so a test driving explicit
 * roots never reads another test's answer.
 *
 * There is deliberately no reset seam: a fixture that needs a fresh scan writes
 * itself under a fresh root, which is what a test asking a different question
 * has to do anyway.
 */
const scans = new Map<string, InstalledPackageScan>();

function scan(roots: readonly string[]): InstalledPackageScan {
  // `\0` because it is the one byte a POSIX path cannot contain, so no two
  // distinct root lists can key the same entry. Written as the **escape**, not
  // as the byte: a raw NUL makes git classify the file as binary, and every
  // diff of it renders as `Binary files differ` — the artefact that would show
  // the byte is the one the byte switches off (issues #182, #190).
  const key = roots.join('\0');
  const cached = scans.get(key);
  if (cached) return cached;
  const fresh = scanNodeModulesRoots(roots);
  scans.set(key, fresh);
  return fresh;
}

/**
 * The module-id claims of every installed module package under `roots`.
 *
 * Exported so the *overlay* seams can be held to one collision rule over one
 * claimed set (feature 103, FR-004) without a second enumeration of what is
 * installed: the scan below is memoised per root list, so asking here costs a
 * map lookup on a boot that has already asked.
 */
export function installedPackageModuleIdClaims(roots: readonly string[]): ModuleIdClaim[] {
  return claimsFor(scan(roots).packages);
}

function claimsFor(packages: readonly InstalledPackage[]): ModuleIdClaim[] {
  return packages.map((installed) => ({
    id: installed.id,
    origin: 'package' as const,
    claimedBy: installed.manifestPath,
    name: installed.name,
  }));
}

/**
 * Resolve one of the package's `exports` subpaths, the way anything in the
 * instance would.
 *
 * Rooted at the directory that *holds* the `node_modules` the package was found
 * under, so Node's own resolver — `exports` map, conditions and all — answers
 * rather than a hand-rolled read of the map. `null` means the package publishes
 * no such subpath, which for `./backend` is an ordinary answer (an admin- or
 * storefront-only module).
 */
function resolveSubpath(installed: InstalledPackage, subpath: string): string | null {
  const require = createRequire(join(dirname(installed.foundUnder), 'noop.js'));
  const specifier = subpath === '.' ? installed.name : `${installed.name}/${subpath}`;
  try {
    return require.resolve(specifier);
  } catch {
    // Narrow by construction: the only thing inside the `try` is a resolution,
    // and a resolution either finds a path or the package does not publish one.
    // Nothing here can reach a port, so nothing here can swallow a
    // `ModuleDisabledError`.
    return null;
  }
}

async function importSubpath(
  installed: InstalledPackage,
  subpath: string,
): Promise<Record<string, unknown> | null> {
  const resolved = resolveSubpath(installed, subpath);
  if (resolved === null) return null;
  return (await import(pathToFileURL(resolved).href)) as Record<string, unknown>;
}

function manifestFrom(module: Record<string, unknown>): ModuleManifest | undefined {
  const named = module['manifest'];
  if (named !== undefined) return named as ModuleManifest;
  const fallback = module['default'];
  return fallback === undefined ? undefined : (fallback as ModuleManifest);
}

/**
 * Read one package's root export and check that it agrees with `package.json`.
 *
 * The id is taken from `endora.id`, because that is the field the platform can
 * read without importing anything — which is what lets discovery refuse a
 * collision before a stranger's code has run. The manifest carries the id too,
 * and a disagreement is refused rather than silently resolved: whichever half
 * the reader believed, the other one is what some part of the platform would
 * have used.
 */
async function manifestEntryFor(
  installed: InstalledPackage,
): Promise<PackageModuleManifest | null> {
  const module = await importSubpath(installed, '.');
  if (module === null) {
    throw new Error(
      `[packages] ${installed.name} declares endora.id "${installed.id}" but publishes no root ` +
        `export, so it has no manifest. A module package's "." export is its manifest ` +
        `(specs/071-modular-packaging/contracts/module-manifest.md). Resolved from ` +
        `${installed.manifestPath}.`,
    );
  }
  const manifest = manifestFrom(module);
  if (manifest === undefined) {
    throw new Error(
      `[packages] the root export of ${installed.name} exports no "manifest", so the module has ` +
        `no version and no declarations to compose it under. Resolved from ` +
        `${installed.manifestPath}.`,
    );
  }
  if (manifest.id !== installed.id) {
    throw new Error(
      `[packages] ${installed.name} disagrees with itself about its module id: its package.json ` +
        `says endora.id "${installed.id}" and its manifest says "${manifest.id}". The two name ` +
        `the same thing and the platform reads both — package.json before anything is imported, ` +
        `the manifest for everything afterwards — so a disagreement makes the module's identity ` +
        `depend on which half a caller looked at. Fix it at ${installed.manifestPath}.`,
    );
  }

  // `exactOptionalPropertyTypes`: an absent key is not `{ hook: undefined }`,
  // and the lifecycle asks `entry.installHook !== undefined`.
  const installHook = module['installHook'] as ModuleManifestExports['installHook'] | undefined;
  const uninstallHook = module['uninstallHook'] as
    | ModuleManifestExports['uninstallHook']
    | undefined;
  const lifecycleParticipant = module['lifecycleParticipant'] as
    | ModuleManifestExports['lifecycleParticipant']
    | undefined;
  const cliCommands = module['cliCommands'] as ModuleManifestExports['cliCommands'] | undefined;
  const recentActivity = module['recentActivity'] as
    | ModuleManifestExports['recentActivity']
    | undefined;

  return {
    id: installed.id,
    manifest,
    filePath: installed.manifestPath,
    packageName: installed.name,
    ...(installHook ? { installHook } : {}),
    ...(uninstallHook ? { uninstallHook } : {}),
    ...(lifecycleParticipant ? { lifecycleParticipant } : {}),
    ...(cliCommands ? { cliCommands } : {}),
    ...(recentActivity ? { recentActivity } : {}),
  };
}

/**
 * The manifests of every installed module package, refusing an id two of them
 * claim.
 *
 * A package with no `./backend` export still appears here: an admin- or
 * storefront-only module has permissions, an activation control and i18n
 * bundles, and dropping the manifest would take all three with it.
 */
export async function packageModuleManifestsUnder(
  roots: readonly string[],
): Promise<PackageModuleManifest[]> {
  const found = scan(roots);
  assertNoModuleIdCollisions(claimsFor(found.packages));
  const out: PackageModuleManifest[] = [];
  for (const installed of found.packages) {
    const entry = await manifestEntryFor(installed);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** {@link packageModuleManifestsUnder} over the roots this platform reads. */
export async function discoverPackageModuleManifests(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PackageModuleManifest[]> {
  return packageModuleManifestsUnder(nodeModulesRootsFor(env));
}

/**
 * The composer entries of every installed module package, against explicit
 * roots.
 *
 * Exported so the loader can be driven over a fixture instance that enters at
 * the top of the analysis — a `node_modules` tree on disk, enumerated,
 * `exports`-resolved and imported by the same code the deployment path runs —
 * rather than by handing the last function a pre-built entry (issue #130).
 */
export async function packageModuleEntriesUnder(
  roots: readonly string[],
): Promise<ModuleEntry[]> {
  const found = scan(roots);
  assertNoModuleIdCollisions(claimsFor(found.packages));

  const entries: ModuleEntry[] = [];
  for (const installed of found.packages) {
    const backend = await importSubpath(installed, 'backend');
    // No `./backend` export at all is an ordinary answer and is skipped, the
    // same way an overlay directory with no `backend.ts` is. A `./backend` that
    // resolves and exports no `registerModule` is a different thing and is
    // refused: skipping it composes nothing, and the first symptom is a 404
    // nobody connects to this file.
    if (backend === null) continue;
    const registerModule = backend['registerModule'];
    if (typeof registerModule !== 'function') {
      throw new Error(
        `[packages] the "./backend" export of ${installed.name} exports no 'registerModule'. ` +
          `A module package's backend entry point is what composes it ` +
          `(specs/071-modular-packaging/contracts/module-manifest.md); remove the export if the ` +
          `package has no server half. It is not composed as written, and a module that composes ` +
          `nothing is a 404 with no error behind it. Resolved from ${installed.manifestPath}.`,
      );
    }
    const manifestEntry = await manifestEntryFor(installed);
    if (manifestEntry === null) continue;
    entries.push({
      id: installed.id,
      version: manifestEntry.manifest.version,
      registerModule: registerModule as ModuleEntry['registerModule'],
      // No `overlay: true`. See this file's header — a package is a stranger,
      // and the decoration exemption is the deployment's alone until something
      // rules otherwise.
      //
      // `installedPackage: true` is the mirror image of that flag and is set
      // from where this loader found the package, never from anything the
      // package declares: it is what makes the kernel refuse a *deployment's*
      // overlay wrapping a registration this package owns (D-176 Q3). Until the
      // decoration drain landed, that case was refused by accident — the root
      // composes overlays before packages, so the name was not in the container
      // yet — and the drain would otherwise have granted a capability the owner
      // declined.
      installedPackage: true,
    });
  }
  return entries;
}

/**
 * Every installed module package this platform composes.
 *
 * Empty for an instance that installed none, which is every developer checkout
 * and every test run — and empty is the whole story there: the composition is
 * byte-for-byte what it was before this loader existed.
 */
export async function loadPackageModuleEntries(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModuleEntry[]> {
  return packageModuleEntriesUnder(nodeModulesRootsFor(env));
}

// ---------------------------------------------------------------------------
// The schema half (feature 080, T033 — D-106.2)
// ---------------------------------------------------------------------------

/**
 * An entity class as the ORM configuration takes it.
 *
 * Deliberately structural and deliberately weak: the host cannot type-check a
 * stranger's class against `EntityClass<T>` without importing the stranger, and
 * MikroORM validates it anyway — something that is not an entity fails metadata
 * discovery loudly and by name.
 */
export type EntityClassLike = new (...args: never[]) => object;

/** What one installed package contributes to the platform's schema. */
export interface PackageSchemaContribution {
  /** The module id it claims (`endora.id`, D-142) — the migrations' `moduleId`. */
  readonly id: string;
  /** The npm package name. For humans, and for the template digest's path. */
  readonly packageName: string;
  readonly version: string;
  /**
   * The directory the `./migrations` subpath resolves into, or `null` when the
   * package publishes no such subpath.
   *
   * The test harness digests the files under it (`test/template-identity.ts`,
   * D-155.5): a package ships compiled `.js` with no `.ts` source to hash, so
   * what it contributes to the migration-template identity as *content* is read
   * from here rather than from any tree this repository owns.
   */
  readonly migrationsDirectory: string | null;
  /** Registry entries, already tagged `origin: 'external'`. */
  readonly migrations: readonly MigrationRegistryEntry[];
  /** The entity classes its `./backend` export declares. */
  readonly entities: readonly EntityClassLike[];
}

function isConstructor(value: unknown): value is EntityClassLike {
  return typeof value === 'function';
}

/**
 * Read a package's `./migrations` export into registry entries.
 *
 * Two published shapes are accepted, because the contract's wording ("exports
 * the migration class array") and the acceptance fixture disagree about which
 * one it means: a bare array of migration classes, and an array of
 * `{ name, class }` — MikroORM's own `MigrationObject` shape. Anything else is
 * **refused rather than skipped**: a migration the host silently drops is a
 * table that never gets created, and the first symptom is a query error nobody
 * connects to this file.
 *
 * The name is always `cls.name`. A declared `name` that disagrees with it is
 * refused for the reason `mikro_orm_migrations` gives: the class name is what
 * is persisted, so the host would record one string and revert by another.
 */
function migrationEntriesFrom(
  installed: InstalledPackage,
  exported: Record<string, unknown>,
): MigrationRegistryEntry[] {
  const declared = exported['migrations'] ?? exported['default'];
  if (!Array.isArray(declared)) {
    throw new Error(
      `[packages] the "./migrations" export of ${installed.name} exports no 'migrations' array. ` +
        `A module package's migrations entry point is the array of its migration classes ` +
        `(specs/071-modular-packaging/contracts/module-manifest.md); drop the export if the ` +
        `package ships no schema. Resolved from ${installed.manifestPath}.`,
    );
  }
  return declared.map((entry, index) => {
    const candidate: unknown = isConstructor(entry)
      ? entry
      : (entry as { class?: unknown } | null)?.class;
    if (!isConstructor(candidate)) {
      throw new Error(
        `[packages] entry ${index} of the "./migrations" export of ${installed.name} is neither ` +
          `a migration class nor a { name, class } pair. Resolved from ${installed.manifestPath}.`,
      );
    }
    const declaredName: unknown = isConstructor(entry)
      ? undefined
      : (entry as { name?: unknown }).name;
    if (typeof declaredName === 'string' && declaredName !== candidate.name) {
      throw new Error(
        `[packages] the "./migrations" export of ${installed.name} declares migration ` +
          `"${declaredName}" for a class named "${candidate.name}". mikro_orm_migrations ` +
          `persists the class name, so the host would record one string and revert by another. ` +
          `Resolved from ${installed.manifestPath}.`,
      );
    }
    return {
      moduleId: installed.id,
      cls: candidate as MigrationRegistryEntry['cls'],
      // Never omitted and never 'core'. The baseline block is a claim about
      // *our* history (`migration-order.ts`), and an entry that lies about its
      // origin joins a frozen prefix it has no business in.
      origin: 'external' as const,
    };
  });
}

/** Read a package's `./backend` export for the entity classes it declares. */
function entityClassesFrom(
  installed: InstalledPackage,
  exported: Record<string, unknown>,
): EntityClassLike[] {
  const declared = exported['entities'];
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) {
    throw new Error(
      `[packages] the "./backend" export of ${installed.name} exports 'entities' that is not an ` +
        `array. It is the list of entity classes the host's ORM registers. Resolved from ` +
        `${installed.manifestPath}.`,
    );
  }
  return declared.map((entry, index) => {
    if (!isConstructor(entry)) {
      throw new Error(
        `[packages] entry ${index} of the 'entities' export of ${installed.name} is not a class. ` +
          `Resolved from ${installed.manifestPath}.`,
      );
    }
    return entry;
  });
}

/**
 * Every installed package's schema contribution, against explicit roots.
 *
 * Exported so a test can drive it over a `node_modules` tree on disk — the same
 * entry point the deployment path takes, enumerated, `exports`-resolved and
 * imported by the same code — rather than by handing a downstream function a
 * pre-built entry (issue #130).
 */
export async function packageSchemaContributionsUnder(
  roots: readonly string[],
): Promise<PackageSchemaContribution[]> {
  const found = scan(roots);
  assertNoModuleIdCollisions(claimsFor(found.packages));

  const out: PackageSchemaContribution[] = [];
  for (const installed of found.packages) {
    const migrationsEntry = resolveSubpath(installed, 'migrations');
    const migrations =
      migrationsEntry === null
        ? []
        : migrationEntriesFrom(
            installed,
            (await import(pathToFileURL(migrationsEntry).href)) as Record<string, unknown>,
          );
    const backend = await importSubpath(installed, 'backend');
    out.push({
      id: installed.id,
      packageName: installed.name,
      version: installed.version,
      migrationsDirectory: migrationsEntry === null ? null : dirname(migrationsEntry),
      migrations,
      entities: backend === null ? [] : entityClassesFrom(installed, backend),
    });
  }
  return out;
}

/**
 * {@link packageSchemaContributionsUnder} over the roots this platform reads.
 *
 * Empty for an instance that installed no module package — every developer
 * checkout and every test run — and empty means the ORM configuration is what
 * it was before a package could ship schema at all.
 */
export async function discoverPackageSchema(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PackageSchemaContribution[]> {
  return packageSchemaContributionsUnder(nodeModulesRootsFor(env));
}
