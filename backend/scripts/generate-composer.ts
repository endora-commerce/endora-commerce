#!/usr/bin/env tsx
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generates the four files that name every module by hand today:
 *
 *   - `backend/src/composition.generated.ts` — the list a composition root
 *     walks: one `{ id, version, registerModule }` entry per converted **core**
 *     module, in the order it must be composed.
 *   - `backend/src/manifest-index.generated.ts` — the one
 *     manifest registry: every core module's manifest, plus the install hooks
 *     it exports.
 *   - `backend/src/db/entities-registry.generated.ts` — the explicit entity
 *     class list MikroORM discovers through.
 *   - `backend/src/db/migrations-registry.generated.ts` — every migration in
 *     the repository, with the module that owns it.
 *   - `admin/src/modules.generated.ts` — the admin contribution registry: the
 *     `./admin` layer of every module package that ships one (feature 091,
 *     Phase 2). The fifth artefact, and the one that converts the last two
 *     hand-written registries a module author had to edit, `admin/src/App.tsx`
 *     and `admin/src/components/AppShell.tsx`.
 *
 * Why generate them (feature 072, FR-030..FR-040): adding a module was three
 * edits in files it does not own, and removing one was an archaeology exercise.
 * When the list is a filesystem walk, adding a module is adding a folder and
 * removing one is deleting it — which is the property US4 tests.
 *
 * Why *one* manifest registry (feature 071, F2): there were two generated files
 * importing the same manifest of the same module, refreshed by two different
 * commands, and only a full build ran both — so deleting a module directory
 * regenerated one and left the other importing a path that no longer existed.
 * Everything the second file added is derivable from the first: a core module's
 * `filePath` is its id under the modules root, and its hooks are exports of the
 * manifest already imported. So `registered-manifests.ts` is now ordinary source
 * that derives `REGISTERED_MANIFESTS` from the index, and this is the only
 * generator that names a manifest.
 *
 * Why the two `db/` registries joined it (feature 071, F2): they were the last
 * two hand-maintained lists, 219 imports and 130 entries, and both fail
 * silently. An entity nobody added surfaces as an ORM error somewhere
 * unrelated; a migration nobody registered simply does not run, so
 * `migration:pending` reports nothing pending and the first symptom is a query
 * against a table that was never created. They are emitted from the same tree
 * walk, by the same command, so the drift that produced this consolidation
 * cannot come back through a fourth file.
 *
 * Usage:
 *   pnpm --filter backend run composer:generate
 *
 * Every output is committed so a build needs no filesystem walk and so a
 * reviewer sees the composition change in the diff. `check-overlay-determinism`
 * re-renders them in-process and byte-compares to disk, which is why the render
 * functions below are pure and exported (and why nothing here shells out to
 * git — the CI slim image has no git).
 */

import {
  absolutePathInPackage,
  declaredExports,
  discoverModulePackages,
  installedModulePackages,
  isDeclaredEntryPoint,
  ModulePackageError,
  packageRelativePathOf,
  packageSpecifierFor,
  readEmitLayout,
  type ModulePackage,
} from './lib/module-packages.js';
import {
  platformPackageNameOf,
  platformSourceRootAt,
  platformSubpathsAt,
  PlatformRootUnresolvableError,
} from './lib/platform-root.js';
import { barrelKeyOf } from './lib/platform-surface.js';
import { declaresRegisterModule } from './lib/module-roots.js';
// The order the published baseline list is rendered in is `orderMigrations`'
// own (R1.3): one derivation, so the artefact cannot come to disagree with the
// algorithm that reads it.
import { BASELINE_THROUGH, historicalBaselineOrder } from '@endora-commerce/platform/db';
import { ADMIN_REGISTRY_ARTEFACT, findAliasMember } from './lib/admin-surfaces.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';
import {
  TAILWIND_REGISTRY_ARTEFACT,
  TAILWIND_SOURCE_SUBPATH,
} from './lib/tailwind-sources.js';
import {
  attributeDocs,
  categoryPositionOf,
  collectDocPages,
  collectModuleDocPages,
  comparePages,
  copyTargetOf,
  DOCS_SIDEBAR_ARTEFACT,
  docsDeclarationIn,
  duplicateDocIds,
  isDirectory,
  labelOf,
  MODULE_MAP_ARTEFACT,
  MODULE_REFERENCE_CATEGORY,
  MODULES_CATEGORY,
  PAGE_EXTENSIONS,
  resolveDocsLayout,
  slugForModule,
  type DocPage,
  type DocsAttribution,
  type DocsLayout,
  type ModuleDocs,
  type ModuleDocsSource,
} from './lib/module-docs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../src');
const modulesRoot = join(srcRoot, 'modules');
/** The repository root — the workspace declaration is one level above `backend/`. */
const repoRoot = resolve(here, '../..');

/**
 * Every module package this repository declares, resolved once per process.
 *
 * Memoised because all four artefacts need it and it is a filesystem read of
 * the workspace globs; the generator is a short-lived CLI, so "once per
 * process" and "once per run" are the same thing. `renderAll` passes the list
 * down explicitly so a test can drive the renderers over a synthetic set.
 */
let modulePackagesCache: readonly ModulePackage[] | null = null;
export function modulePackages(): readonly ModulePackage[] {
  modulePackagesCache ??= discoverModulePackages(repoRoot);
  return modulePackagesCache;
}

const composerOutputPath = join(srcRoot, 'composition.generated.ts');
const manifestIndexOutputPath = join(srcRoot, 'manifest-index.generated.ts');
const entitiesRegistryOutputPath = join(srcRoot, 'db', 'entities-registry.generated.ts');
const migrationsRegistryOutputPath = join(srcRoot, 'db', 'migrations-registry.generated.ts');

/**
 * How the emitted manifest index reaches {@link resolveManifestPath}.
 *
 * Computed from the two paths rather than written as `'./manifest-locations.js'`,
 * so that moving either file — the index becomes host-owned under `backend/src/`
 * per D-160.3 — changes this specifier in the next regeneration instead of
 * leaving an artefact that imports a path no longer there (D-100).
 */
const manifestLocationsPath = join(srcRoot, 'manifest-locations.ts');
const manifestLocationsSpecifier = ((): string => {
  const relativePath = relative(dirname(manifestIndexOutputPath), manifestLocationsPath)
    .split('\\')
    .join('/')
    .replace(/\.ts$/, '.js');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
})();

/**
 * Where every committed artefact lands. Exported so `overlay:check` can state
 * what it covers without rendering anything, and so a test can compare that
 * against the `*.generated.ts` files actually on disk — a generated file no
 * determinism gate looks at is a file that drifts unnoticed, which is the
 * defect this generator was consolidated to end.
 *
 * A **function** rather than a constant since feature 091's fifth artefact:
 * the admin registry's location is derived from the workspace member declaring
 * the `"@/*"` alias, which is filesystem work, and a module-level constant
 * would do it at *import* time — so a tree with no such member would throw
 * before any caller had a chance to say what it was doing.
 */
export function generatedArtifactPaths(): readonly string[] {
  return [
    composerOutputPath,
    manifestIndexOutputPath,
    entitiesRegistryOutputPath,
    migrationsRegistryOutputPath,
    baselineListOutputPath(),
    adminRegistryOutputPath(),
    tailwindRegistryOutputPath(),
    ...docsArtefactPaths(),
  ];
}

/**
 * The two documentation artefacts, at the site the workspace declares.
 *
 * A function for the same reason `adminRegistryOutputPath` is: the site's
 * location is filesystem work over the workspace globs, and a module-level
 * constant would do it at *import* time — so a tree with no Docusaurus site
 * would throw before any caller had a chance to say what it was doing.
 */
function docsArtefactPaths(): readonly string[] {
  const layout = resolveDocsLayout(repoRoot);
  return [
    join(layout.member.dir, DOCS_SIDEBAR_ARTEFACT),
    join(layout.modulesRoot, MODULE_MAP_ARTEFACT),
    // One reference page per module (Phase 3). They are *many* artefacts rather
    // than one for FR-024's reason — `overlay:check` renders a whole artefact
    // twice and byte-compares, so a file holding 66 modules' tables would be
    // one verdict over the lot and a diff nobody can read. Which pages exist is
    // a manifest declaration read from source text, so this stays synchronous.
    ...referencePagePaths(layout, discoverManifests()).values(),
  ];
}

/**
 * The one ordering constraint that is a **construction** dependency rather than
 * a manifest one, and therefore cannot be derived: `integrationsModule`
 * (`api_keys`) is constructed first so its API-key authenticator can be handed
 * to the auth plugin — `composition.ts` builds it at the top of its module
 * composition and reads `integrations.handle.apiKeyService.authenticate` as the
 * plugin's `apiKeyResolver`. `api_keys`' manifest declares nothing about
 * `auth`, so nothing derivable orders the two: it is one of the
 * imported-but-undeclared edges F3 is scoped to fix. Until it does, the
 * ordering is pinned here, in the open, instead of being an accident of the
 * order a hand-written file happened to call factories in.
 *
 * The pin is a priority, not an override: if `api_keys` ever declares a real
 * dependency, that dependency still composes before it.
 */
const PINNED_FIRST: readonly string[] = ['api_keys'];

/** One module, as the generator sees it. */
export interface ComposerNode {
  readonly id: string;
  /** `manifest.dependencies`, verbatim. Edges to unconverted modules are ignored. */
  readonly dependencies: readonly string[];
  readonly backendImportPath: string;
  readonly manifestImportPath: string;
}

/**
 * A module is *converted* when it ships a `backend.ts` exporting
 * `registerModule`. A `backend.ts` that exports no such thing is a mistake, not
 * a module that opted out — and it is reported rather than skipped, because a
 * skipped module composes nothing and the first symptom is a 404 in a suite
 * nobody connects to this file.
 */
function exposesRegisterModule(filePath: string): boolean {
  const source = readFileSync(filePath, 'utf8');
  if (declaresRegisterModule(source)) {
    return true;
  }
  throw new Error(
    `[composer] ${filePath} exports no 'registerModule'. A module's backend.ts is its entry ` +
      `point (see modules/blog/backend.ts); rename or remove the file if it is not one.`,
  );
}

function directoriesIn(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .sort()
    .filter((name) => !name.startsWith('.') && statSync(join(root, name)).isDirectory());
}

/**
 * A module whose sources the **host application** owns, rather than a modules
 * root or a package (feature 080, T040b).
 *
 * There is one, `_lifecycle`, and it is one because of D-160.11: the lifecycle
 * subsystem is the platform's operator half, so it never became
 * `@endora-commerce/mod-lifecycle` the way the other 66 modules did. It is
 * still a registered module — it carries a manifest, permissions, an activation
 * declaration, a palette action and two i18n bundles, and every other module's
 * installation is recorded against it — so all three walks below have to find
 * it, and its directory is not under `modulesRoot` any more.
 *
 * Two things are deliberately derived rather than written down (D-100). The
 * directory is found by walking the source root's own children for a
 * lifecycle-shape `manifest.ts`, the same marker core discovery uses one level
 * down, so a second host-resident module needs no edit here. And the **id comes
 * out of the manifest**, never off the directory name: `_lifecycle` lives in
 * `src/lifecycle/` precisely because the two must differ —
 * `scripts/lib/module-roots.ts` reads a directory *named* after a registered id
 * as a module directory, so `src/_lifecycle/` would make `backend/src` itself a
 * module root and every kernel file a module's source.
 */
interface HostResidentModule {
  readonly id: string;
  readonly directory: string;
  readonly manifestPath: string;
  /**
   * How a generated artefact at the source root names a file in this module's
   * directory — `./lifecycle/manifest.js` for a module the application's own
   * tree holds, `@endora-commerce/platform/lifecycle` for one inside the
   * platform package. See {@link residentModules}.
   */
  readonly specifierFor: (absolutePath: string) => string;
}

const MANIFEST_ID_RE = /defineModuleManifest\(\{[\s\S]*?\bid:\s*'([^']+)'/;

/**
 * Every module whose sources are neither a modules root's nor a module
 * package's — the application's own, and the platform's.
 *
 * The application half is `srcRoot`'s immediate children; there are none today,
 * and there were for the two commits between !1095 and D-160.11's second half.
 * The platform half is `packages/platform/src`'s, and there is one: `_lifecycle`
 * merged into the host package, which is what D-160.11 rules. Both are found by
 * the **same marker** core discovery uses one level down — a lifecycle-shape
 * `manifest.ts` — and the **id comes out of the manifest**, never off the
 * directory name: `_lifecycle` lives in `lifecycle/` precisely because the two
 * must differ, since `scripts/lib/module-roots.ts` reads a directory *named*
 * after a registered id as a module directory and a `src/_lifecycle/` would make
 * the whole source root one.
 *
 * **The platform half's specifier is the bare one its `exports` map declares**
 * (`specs/115-lifecycle-container-move/`, Phase 6). It was
 * `../../packages/platform/dist/lifecycle/manifest.js` until then — a relative
 * path into a sibling package's build output, which resolves in this checkout
 * and in **no** client instance, so the artefact whose whole job is to register
 * the modules a build ships could not register `_lifecycle` anywhere else. That
 * spelling was not a design: at the time the host published five subpaths and
 * none of them reached the operator half, so there was no bare specifier to
 * emit. D115-4 added `./lifecycle` — declared, host-internal, carried by no
 * published barrel — and this is what it was added for.
 *
 * It still names the **built** file rather than the source, because that is
 * what the `exports` map resolves to: naming the source would evaluate the
 * platform a second time — 59 runtime values, none shared, `instanceof
 * HttpError` false across the boundary (host-package.md §3.5), which is exactly
 * what `check:singleton-identity` refuses. And a bare specifier is correct from
 * `backend/src` under `tsx` and from `backend/dist` in production without being
 * rewritten, which the relative one was only because `src` and `dist` happened
 * to sit at the same depth.
 *
 * **Which** subpath is derived, never written down (D-100): it is the most
 * specific one the platform's own `exports` map declares whose target covers the
 * file, by `packageSpecifierFor` — the same rule that names a module package's
 * files, so a platform directory that gains an address, or renames one, is
 * followed rather than refused. A file no declared subpath covers is a
 * **refusal**, because a committed registry importing it would get
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` and skipping it is how a module drops out of
 * an artefact with no error anywhere.
 */
export function residentModules(): HostResidentModule[] {
  const found: HostResidentModule[] = [];
  const collect = (
    root: string,
    specifierFor: (absolutePath: string) => string,
  ): void => {
    for (const name of directoriesIn(root)) {
      const directory = join(root, name);
      if (directory === modulesRoot) continue;
      const manifestPath = join(directory, 'manifest.ts');
      if (!existsSync(manifestPath)) continue;
      const source = readFileSync(manifestPath, 'utf8');
      const id = MANIFEST_ID_RE.exec(source)?.[1];
      if (id === undefined) continue;
      found.push({ id, directory, manifestPath, specifierFor });
    }
  };
  collect(srcRoot, srcSpecifier);
  const platformRoot = platformSourceRootAt(repoRoot);
  if (platformRoot !== null) collect(platformRoot, platformSubpathSpecifier(platformRoot));
  return found;
}

// ── the population an artefact is rendered over ─────────────────────────────
//
// `specs/110-instance-repository/` FR-005/FR-006 and
// `contracts/instance-repository.md` R3.5. Two of the seven artefacts this
// generator emits — the admin contribution registry and the two documentation
// files — are rendered in a **client's instance** as well as here, because a
// static build has no runtime discovery: Vite bundles a screen and Docusaurus
// copies a page, and neither can be told at boot which modules were installed.
//
// The other five are **not**, and must not be: an installed package is
// discovered at runtime (D-119, D-155), so baking one into a committed registry
// registers it twice. `contracts/instance-repository.md` R3.3 is that rule and
// `overlay:check`'s `foreign` verdict is what enforces it *here*.
//
// So what changes between the two trees is the **population**, and nothing else
// — one generator, one derivation of how an artefact names a file inside a
// package (R3.5). In this repository the modules are workspace members and the
// application's own tree holds `_lifecycle`; in an instance they are the
// packages `node_modules` holds and the application half is empty, because a
// client's tree holds no module source at all (D-207).

/**
 * The modules the host application's own tree holds, rather than a package.
 *
 * `null` is an **instance**: not "none found", but "there is no application
 * tree to look in". The distinction is the difference between a walk that came
 * back empty and one that was never asked.
 */
export interface ApplicationModules {
  /** Where a module directory of the application's own would be. */
  readonly modulesRoot: string;
  /** Modules the host owns outside that root — `_lifecycle` (D-160.11). */
  readonly resident: readonly HostResidentModule[];
}

/** Which modules an artefact is rendered over, and the tree it lands in. */
export interface ArtefactPopulation {
  /** This repository's root, or a client instance's. */
  readonly root: string;
  /** Workspace members here; the packages `node_modules` holds in an instance. */
  readonly packages: readonly ModulePackage[];
  /** `null` in an instance — see {@link ApplicationModules}. */
  readonly application: ApplicationModules | null;
}

/** This repository: workspace members, plus the modules the host itself owns. */
export function workspacePopulation(
  packages: readonly ModulePackage[] = modulePackages(),
): ArtefactPopulation {
  return {
    root: repoRoot,
    packages,
    application: { modulesRoot, resident: residentModules() },
  };
}

/**
 * A client's instance: the modules it installed, and no application modules.
 *
 * The walk is `@endora-commerce/cli`'s, shared with the workspace half, so the
 * two populations are named by one `exports`-map derivation and cannot come to
 * disagree about how an artefact spells a package's admin layer or its pages.
 */
export function instancePopulation(instanceRoot: string): ArtefactPopulation {
  return {
    root: instanceRoot,
    packages: installedModulePackages(instanceRoot),
    application: null,
  };
}

/**
 * `<platform>/src/lifecycle/manifest.ts` -> `@endora-commerce/platform/lifecycle`.
 *
 * The platform is not a module package — it declares `endora.type: "platform"`
 * and claims no module id — but the question asked of it here is a module
 * package's exactly: *which declared subpath does a committed artefact name this
 * file by?* So it is answered by the same function, over a record built from the
 * platform's own manifest, rather than by a second derivation that could come to
 * disagree with it (D-100). `packageSpecifierFor` maps the source through the
 * package's emit layout and picks the longest covering `exports` target, which
 * for `src/lifecycle/manifest.ts` is `dist/lifecycle/manifest.js` under
 * `./lifecycle`'s barrel.
 *
 * Both files this is asked about — the manifest and `backend.ts` — therefore
 * answer with the **same** specifier, which is right: one subpath for one
 * surface (D115-4), and a consumer that wants one symbol imports one symbol.
 */
function platformSubpathSpecifier(platformRoot: string): (absolutePath: string) => string {
  const packageDir = dirname(platformRoot);
  const fs = nodeWorkspaceFs();
  const member = workspaceMembers(repoRoot, fs).find((candidate) => candidate.dir === packageDir);
  if (member === undefined) {
    throw new PlatformRootUnresolvableError(
      `${packageDir} holds the platform's sources and is not a workspace member. Its ` +
        '`exports` map is what a generated artefact names its files by, and a package no ' +
        'workspace glob reaches has no manifest to read it from.',
    );
  }
  const platformAsPackage: ModulePackage = {
    // Never read on this path: `packageSpecifierFor` and `emittedPathOf` take
    // `name`, `exports` and `emit` only. The platform makes no module claim of
    // its own, and the ids of the modules whose sources it holds come out of
    // their own manifests in `residentModules` above.
    moduleId: `${member.name} (not a module package)`,
    name: member.name,
    dir: member.dir,
    exports: declaredExports(member.manifest),
    emit: readEmitLayout(member.dir, member.name, fs),
  };
  return (absolutePath: string): string =>
    packageSpecifierFor(platformAsPackage, packageRelativePathOf(platformAsPackage, absolutePath));
}

/** How the emitted index, which sits at the source root, names a file under it. */
function srcSpecifier(absolutePath: string): string {
  const relativePath = relative(dirname(manifestIndexOutputPath), absolutePath)
    .split('\\')
    .join('/')
    .replace(/\.ts$/, '.js');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

interface DiscoveredConverted {
  id: string;
  /** Absolute path to the module's `manifest.ts` — read for `manifest.dependencies`. */
  manifestPath: string;
  backendImportPath: string;
  manifestImportPath: string;
}

/**
 * Every converted **core** module.
 *
 * Core only, and `DEPLOYMENT`-independent (D-104). A deployment's overlay
 * modules used to be discovered here and emitted into this shared artefact,
 * which made the committed file correct for exactly one value of an environment
 * variable — so a run with the variable set reported it stale on every
 * invocation, and a run without it never looked at the deployment at all. That
 * is the defect issue #120 ruled on for the override manifests, in the family it
 * was not applied to: an artefact that is always stale for a deployment is one
 * nobody can use to detect a genuinely stale one.
 *
 * A deployment's converted modules are discovered at **runtime** instead, by
 * `loadOverlayModuleEntries` in `src/overlay/overlay-runtime.ts` — the way its
 * manifests already were, and for the same reason: which deployment a build is
 * depends on the process, not on the tree a generator was run against.
 */
function discoverConverted(packages: readonly ModulePackage[] = modulePackages()): DiscoveredConverted[] {
  const byId = new Map<string, DiscoveredConverted>();
  for (const id of directoriesIn(modulesRoot)) {
    const backend = join(modulesRoot, id, 'backend.ts');
    if (!existsSync(backend)) continue;
    exposesRegisterModule(backend);
    byId.set(id, {
      id,
      manifestPath: join(modulesRoot, id, 'manifest.ts'),
      backendImportPath: `./modules/${id}/backend.js`,
      manifestImportPath: `./modules/${id}/manifest.js`,
    });
  }
  for (const host of residentModules()) {
    const backend = join(host.directory, 'backend.ts');
    if (!existsSync(backend)) continue;
    exposesRegisterModule(backend);
    byId.set(host.id, {
      id: host.id,
      manifestPath: host.manifestPath,
      backendImportPath: host.specifierFor(backend),
      manifestImportPath: host.specifierFor(host.manifestPath),
    });
  }
  for (const pkg of packages) {
    const entry = packageEntryPoints(pkg);
    byId.set(pkg.moduleId, {
      id: pkg.moduleId,
      manifestPath: entry.manifestPath,
      backendImportPath: entry.backendSpecifier,
      manifestImportPath: entry.manifestSpecifier,
    });
  }
  return [...byId.values()];
}

/**
 * Where a module package keeps its two entry points, and how a generated
 * artefact names them (feature 080, T041a).
 *
 * Both are located by the **same two markers core discovery uses** — the file
 * declaring `defineModuleManifest(` is the manifest, the file exporting
 * `registerModule` is the composition entry — and then named through the
 * package's own `exports` map. Neither `./backend` nor `.` is written here: a
 * package whose backend barrel merely re-exports `registerModule` from a
 * neighbour still resolves to the subpath covering that neighbour, which is the
 * same subpath, and a package that spells its layers differently is followed
 * rather than refused.
 *
 * Exactly one of each is required. Zero means a package that declares itself a
 * module and composes nothing; two means the artefact would have to choose, and
 * a generator that chooses silently is how a module comes to be registered from
 * a file nobody meant.
 */
function packageEntryPoints(pkg: ModulePackage): {
  manifestPath: string;
  manifestSpecifier: string;
  backendSpecifier: string;
} {
  const sources = readTree(pkg.dir, pkg);
  if (sources.size === 0) {
    const manifest = publishedManifestEntry(pkg);
    return { ...manifest, backendSpecifier: publishedBackendSpecifier(pkg) };
  }
  const declaring = (predicate: (text: string) => boolean): string[] =>
    [...sources]
      .filter(([, entry]) => predicate(entry.text))
      .map(([file]) => file)
      .sort();

  const manifests = declaring((text) =>
    /export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(text),
  );
  const backends = declaring((text) => declaresRegisterModule(text));
  const one = (files: readonly string[], what: string, marker: string): string => {
    if (files.length === 1) return files[0]!;
    throw new ModulePackageError(
      `[composer] ${pkg.name} declares module '${pkg.moduleId}' and holds ${files.length} ` +
        `file(s) ${what} (${files.join(', ') || 'none'}). Exactly one is required: the ` +
        `generator locates it by ${marker}, the same marker it uses for a module in the ` +
        `application tree, and neither zero nor two can be turned into a registry entry.`,
    );
  };

  const manifestFile = one(manifests, 'exporting a lifecycle-shape manifest', 'defineModuleManifest(');
  const backendFile = one(backends, 'exporting registerModule', 'the registerModule export');
  return {
    manifestPath: absolutePathInPackage(pkg, manifestFile),
    manifestSpecifier: packageSpecifierFor(pkg, manifestFile),
    backendSpecifier: packageSpecifierFor(pkg, backendFile),
  };
}

/**
 * A package's own root export, for a package that ships **no sources**.
 *
 * The two locators above search source text for a marker, because a source tree
 * declares nowhere which of its files is the manifest. A *published* package
 * does declare it: the `.` subpath of its `exports` map is the package's
 * statement about its own entry point, and it is the file `import '<name>'`
 * loads — so the marker search is not merely unavailable here (there is no
 * `.ts` to search), it is the wrong question. A third-party author's published
 * manifest is a plain object literal and names `defineModuleManifest` nowhere,
 * which is what the installed-package fixtures ship.
 *
 * A package declaring no `.` subpath, or one whose target is not on disk, is a
 * **refusal**: the artefact would import a specifier the package refuses with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, and skipping it is how a module drops out of
 * a client's admin bundle or documentation with no error anywhere.
 */
function publishedManifestEntry(pkg: ModulePackage): {
  manifestPath: string;
  manifestSpecifier: string;
} {
  const target = pkg.exports.get('.');
  if (target === undefined) {
    const declared = [...pkg.exports.keys()].sort().join(', ') || '(none)';
    throw new ModulePackageError(
      `[composer] ${pkg.name} declares module '${pkg.moduleId}', ships no sources, and its ` +
        `exports map declares no '.' subpath (declared: ${declared}). That subpath is where a ` +
        `published package states its own entry point, and it is the only thing an artefact ` +
        `can name it by.`,
    );
  }
  const relativePath = target.replace(/^\.\//, '');
  const manifestPath = absolutePathInPackage(pkg, relativePath);
  if (!existsSync(manifestPath)) {
    throw new ModulePackageError(
      `[composer] ${pkg.name} exports '.' as ${target}, and that file is not in the package. ` +
        `An artefact naming it would fail at its first import; a package whose own entry ` +
        `point is missing is not one this run can register.`,
    );
  }
  return { manifestPath, manifestSpecifier: packageSpecifierFor(pkg, relativePath) };
}

/**
 * The published subpath whose target exports `registerModule`, for a package
 * that ships no sources.
 *
 * Every declared subpath is read, in the same discipline as the source walk:
 * the file that carries the marker is the composition entry, whatever the
 * subpath is called. `./backend` is written nowhere.
 */
function publishedBackendSpecifier(pkg: ModulePackage): string {
  const found: string[] = [];
  for (const [subpath, target] of pkg.exports) {
    if (subpath === './package.json') continue;
    const relativePath = target.replace(/^\.\//, '');
    const file = absolutePathInPackage(pkg, relativePath);
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    if (declaresRegisterModule(readFileSync(file, 'utf8'))) found.push(relativePath);
  }
  if (found.length !== 1) {
    throw new ModulePackageError(
      `[composer] ${pkg.name} declares module '${pkg.moduleId}' and ${found.length} of its ` +
        `published subpaths export registerModule (${found.join(', ') || 'none'}). Exactly ` +
        `one is required: it is the file the platform composes, and neither zero nor two can ` +
        `be turned into a registry entry.`,
    );
  }
  return packageSpecifierFor(pkg, found[0]!);
}

/**
 * Reads `dependencies` off the module's real manifest rather than parsing the
 * source: the manifest is the declaration the ordering is supposed to follow,
 * and a regex would answer `[]` for anything it failed to recognise — which is
 * a wrong order that boots and then fails somewhere else.
 */
async function loadManifest(manifestPath: string): Promise<{ id: string; dependencies: string[] }> {
  const mod = (await import(pathToFileURL(manifestPath).href)) as {
    manifest?: { id?: string; dependencies?: readonly string[] };
  };
  const manifest = mod.manifest;
  if (!manifest?.id) {
    throw new Error(`[composer] ${manifestPath} exports no lifecycle-shape manifest`);
  }
  return { id: manifest.id, dependencies: [...(manifest.dependencies ?? [])] };
}

/** One present module, as the dependency-presence check sees it. */
export interface PresentModule {
  readonly id: string;
  readonly dependencies: readonly string[];
}

/**
 * A module names a dependency that is not in the tree (FR-035, US4).
 *
 * This is the failure that makes removal safe. Deleting a module's directory
 * removes it from every generated artefact — but a module that *declared* it
 * keeps declaring it, and nothing downstream reads that declaration until the
 * lifecycle resolves dependencies at runtime and fails closed. The result is a
 * build that succeeds and a platform that answers 503 for a capability the
 * operator never switched off, which is the exact shape of failure this feature
 * exists to prevent. So generation stops, naming the missing module **and** the
 * modules that still want it — because the fix is in the dependents, not in the
 * module that is gone.
 */
export class MissingModuleDependencyError extends Error {
  constructor(readonly missing: ReadonlyMap<string, readonly string[]>) {
    const lines = [...missing]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, dependents]) => `  '${id}' — still declared by: ${[...dependents].sort().join(', ')}`);
    super(
      `[composer] ${missing.size} module dependenc${missing.size === 1 ? 'y is' : 'ies are'} ` +
        `declared but not present in the tree:\n${lines.join('\n')}\n` +
        `  Removing a module is deleting its directory; the modules above still name it in ` +
        `\`manifest.dependencies\`. Drop the declaration from each dependent, or restore the ` +
        `module. A missing dependency that reaches runtime fails closed as a 503 for a ` +
        `capability nobody switched off.`,
    );
    this.name = 'MissingModuleDependencyError';
  }
}

/**
 * Every declared dependency names a module that exists (T056).
 *
 * Scope is the **shared core tree**: this is the guard that a declaration names
 * a module still in the repository, and the repository is the same whichever
 * deployment a build composes. A deployment that ships a *reduced* set is a
 * different question and cannot be answered here — a split is assembled without
 * regenerating anything, so a guard that only fires when a generator runs is one
 * the failure routes around.
 */
export function assertDependenciesPresent(modules: readonly PresentModule[]): void {
  const present = new Set(modules.map((module) => module.id));
  const missing = new Map<string, string[]>();
  for (const module of modules) {
    for (const dependency of module.dependencies) {
      if (present.has(dependency)) continue;
      const dependents = missing.get(dependency) ?? [];
      dependents.push(module.id);
      missing.set(dependency, dependents);
    }
  }
  if (missing.size > 0) throw new MissingModuleDependencyError(missing);
}

/** Every core module that ships a lifecycle-shape manifest (D-104: core only). */
async function discoverPresentModules(
  packages: readonly ModulePackage[] = modulePackages(),
): Promise<PresentModule[]> {
  const byId = new Map<string, PresentModule>();
  for (const id of directoriesIn(modulesRoot)) {
    const manifestPath = join(modulesRoot, id, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    if (!/export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(readFileSync(manifestPath, 'utf8'))) {
      continue;
    }
    byId.set(id, await loadManifest(manifestPath));
  }
  for (const host of residentModules()) {
    byId.set(host.id, await loadManifest(host.manifestPath));
  }
  for (const pkg of packages) {
    byId.set(pkg.moduleId, await loadManifest(packageEntryPoints(pkg).manifestPath));
  }
  return [...byId.values()];
}

/**
 * Registration order (FR-034): dependencies before dependents, the pinned
 * exception ahead of everything it does not itself depend on, ties broken
 * alphabetically so the emitted file is a function of the tree and nothing else.
 *
 * "Overlay modules last" is no longer a rank in this sort. It is structural
 * (D-104): a composition root appends the deployment's entries to this frozen
 * core list, so a deployment's decoration always wraps a core registration that
 * is already there, whatever this function does.
 *
 * Kahn's algorithm over the subgraph induced by the modules actually in the
 * list: a declared dependency on a module absent from it constrains nothing
 * here, because that module is not in this order at all.
 */
export function orderModules(nodes: readonly ComposerNode[]): ComposerNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pending = new Map<string, Set<string>>(
    nodes.map((n) => [n.id, new Set(n.dependencies.filter((d) => byId.has(d) && d !== n.id))]),
  );

  const rank = (node: ComposerNode): number => (PINNED_FIRST.includes(node.id) ? 0 : 1);
  const readyOrder = (a: ComposerNode, b: ComposerNode): number =>
    rank(a) - rank(b) || a.id.localeCompare(b.id);

  const ordered: ComposerNode[] = [];
  while (pending.size > 0) {
    const ready = [...pending]
      .filter(([, deps]) => deps.size === 0)
      .map(([id]) => byId.get(id))
      .filter((n): n is ComposerNode => n !== undefined)
      .sort(readyOrder);
    if (ready.length === 0) {
      const stuck = [...pending]
        .map(([id, deps]) => `${id} -> ${[...deps].sort().join(', ')}`)
        .sort();
      throw new Error(
        `[composer] dependency cycle between modules; nothing can be composed first:\n  ${stuck.join('\n  ')}`,
      );
    }
    const next = ready[0];
    if (!next) break;
    ordered.push(next);
    pending.delete(next.id);
    for (const deps of pending.values()) deps.delete(next.id);
  }
  return ordered;
}

const HEADER = (script: string): string =>
  `// AUTO-GENERATED by scripts/${script} — DO NOT EDIT.\n` +
  `// Run \`pnpm --filter backend run composer:generate\` (or rebuild the backend)\n` +
  `// to refresh. Editing this file by hand is undone by the next build, and\n` +
  `// \`pnpm --filter backend run overlay:check\` fails on the drift.\n`;

/**
 * Pure render of the composer array.
 *
 * Exported so a test can drive it on synthetic nodes. It emits **no** overlay
 * marker, under any input: since D-104 nothing a deployment ships reaches this
 * file, and `ModuleEntry.overlay` — the flag the kernel's decoration exemption
 * reads — is set by `loadOverlayModuleEntries` from the root the module was
 * discovered under. The proof that the flag is derived from a location and not
 * from a module's own claim moved there with it (issue #203).
 */
export function emitComposer(nodes: readonly ComposerNode[]): string {
  // camelCase aliases: the emitted file is linted like any other source file.
  const imports = nodes
    .map(
      (n, i) =>
        `import * as module${i} from '${n.backendImportPath}';\n` +
        `import { manifest as manifest${i} } from '${n.manifestImportPath}';`,
    )
    .join('\n');

  const entries = nodes
    .map(
      (n, i) =>
        `  { id: '${n.id}', version: manifest${i}.version, registerModule: module${i}.registerModule },`,
    )
    .join('\n');

  return `${HEADER('generate-composer.ts')}//
// Every **core** module that ships a \`backend.ts\` exporting \`registerModule\`,
// in the order a composition root must compose them:
//
//   1. \`${PINNED_FIRST.join('\`, \`')}\` first — a **construction** dependency, not a manifest one:
//      the API-key authenticator is injected into the auth plugin, and
//      \`api_keys\`' manifest declares nothing about \`auth\`. Pinned here, in the
//      open, until F3 fixes the declaration.
//   2. then a topological order over \`manifest.dependencies\`, ties broken
//      alphabetically so this file is a function of the tree and nothing else.
//
// This list is bare core under every value of \`DEPLOYMENT\` (D-104). A
// deployment's overlay modules are discovered at runtime by
// \`loadOverlayModuleEntries\` (\`src/overlay/overlay-runtime.ts\`) and **appended**
// to this list in the one \`composeModules\` call, which is what keeps this
// committed artefact meaning the same thing in every environment.
//
// **Position in this array decides nothing about decoration**, and this header
// used to say it did: it read "overlay last, so a deployment's
// \`di.decorate\` wins". There is no winning — two modules decorating one name
// is refused outright (\`AmbiguousDecorationError\`) — and since D-176 every
// \`ctx.di.decorate\` is queued during registration and drained after the last
// module has registered, so a wrap cannot depend on who composed first. The
// ownership guard is the only policy instrument, which is exactly what D-176
// Q1 ruled the array order is not.
//
// A module missing from this list is a module the tree walk found no
// \`backend.ts\` for. Every core module exports \`registerModule\` today, so an
// absence here means a file was not written or not named \`backend.ts\` — not
// that the module is composed somewhere else.

// \`specs/110-instance-repository/\` T119b — the address, not the shim.
// \`backend/src/kernel/compose.ts\` was a re-export over
// \`packages/platform/dist/kernel/compose.js\`, so this artefact named a path that
// resolves in this checkout and in no client's; \`./composition\` is the
// host-internal subpath that carries \`ModuleEntry\`, and it is host-internal for
// the reason this file is the only thing that needs it — a module that could
// name it could compose its siblings.
import type { ModuleEntry } from '@endora-commerce/platform/composition';

${imports}

export const MODULES: readonly ModuleEntry[] = [
${entries}
];
`;
}

/** Pure render — the target path + expected content of the module composer. */
export async function renderComposer(): Promise<{ outputPath: string; content: string }> {
  // Before anything is emitted: every declared dependency names a module that
  // is still in the tree (T056). A generated composer that quietly drops a
  // removed module and leaves its dependents declaring it produces a build
  // that boots and then fails closed at runtime.
  const packages = modulePackages();
  assertDependenciesPresent(await discoverPresentModules(packages));
  const discovered = discoverConverted(packages);
  const nodes: ComposerNode[] = [];
  for (const entry of discovered) {
    const manifest = await loadManifest(entry.manifestPath);
    if (manifest.id !== entry.id) {
      throw new Error(
        `[composer] ${entry.id}/manifest.ts declares id '${manifest.id}'; a module's folder name is its id`,
      );
    }
    nodes.push({
      id: entry.id,
      dependencies: manifest.dependencies,
      backendImportPath: entry.backendImportPath,
      manifestImportPath: entry.manifestImportPath,
    });
  }
  return { outputPath: composerOutputPath, content: emitComposer(orderModules(nodes)) };
}

interface DiscoveredManifest {
  id: string;
  /** Import specifier from the emitted index to the module's `manifest.ts`. */
  importPath: string;
  /**
   * The module's own documentation layer, as its manifest declares it — the
   * declared directory joined to the module's root (feature 100 Phase 2).
   *
   * `null` when the manifest declares `docs: false` or declares nothing. The
   * root is the anchor the *platform* supplies, exactly as `i18n.bundlesDir`'s
   * is, so nothing in the module names a package or a build directory in order
   * to find its own pages.
   */
  docsRoot: string | null;
  /**
   * The manifest file itself, absolute — what the reference-page renderer
   * imports (FR-022).
   *
   * {@link DiscoveredManifest.importPath} is the specifier the *emitted index*
   * writes and is not a path this process can import: a packaged module's is a
   * bare `@endora-commerce/mod-<id>`, which resolves through the package's
   * `exports` map to its **build output** and would read a manifest that is one
   * `pnpm run build:packages` behind the tree this generator is rendering.
   */
  manifestPath: string;
  /**
   * `true` only for a manifest that declares `docs: false` — never for one that
   * declares nothing.
   *
   * The two are one field apart and are not the same state (`R3.1`), and
   * {@link DiscoveredManifest.docsRoot} deliberately answers `null` for both. A
   * module that has *decided* it documents nothing is owed no generated page
   * either: the platform does not overrule a module's own declaration about its
   * documentation.
   */
  declaresNoDocs: boolean;
  hasInstallHook: boolean;
  hasUninstallHook: boolean;
  hasLifecycleParticipant: boolean;
  hasCliCommands: boolean;
  hasRecentActivity: boolean;
}

/**
 * Does this manifest export `<name>`, and is the export in a shape we can wire?
 *
 * Two spellings are wired: `export const <name> = …` and
 * `export [async] function <name>(…)`. The second used to be invisible — the
 * detector matched only `export const`, so a module that wrote the hook as an
 * async function declaration, which is the spelling a TypeScript author reaches
 * for first, was silently ignored: the generated composer wired nothing, the
 * hook never ran, and nothing anywhere said so.
 *
 * Any *other* export of that name — a re-export, a destructured binding — throws
 * rather than being dropped. Silently accepting one spelling is what produced
 * the defect; a generator that cannot wire a hook must say so, because the
 * manifest is now the **only** install seam (D-46 deleted the container-side one)
 * and a hook that does not run looks exactly like a hook with nothing to do.
 */
export function detectHookExport(name: string, source: string, moduleId: string): boolean {
  const asConst = new RegExp(`export\\s+(?:const|let|var)\\s+${name}\\s*[:=]`).test(source);
  const asFunction = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\s*[<(]`).test(source);
  if (asConst || asFunction) return true;

  const mentionedInAnExport = new RegExp(`export[^\\n]*\\b${name}\\b`).test(source);
  if (mentionedInAnExport) {
    throw new Error(
      `[composer] ${moduleId}/manifest.ts exports '${name}' in a shape the generator ` +
        `cannot wire. Write it as 'export const ${name} = …' or ` +
        `'export async function ${name}(…)'. It is not wired as written, so the hook ` +
        `would never run.`,
    );
  }
  return false;
}

/**
 * Every **core** module with a lifecycle-shape manifest.
 *
 * Core only, and `DEPLOYMENT`-independent (D-104), for the reason spelled out
 * over {@link discoverConverted}: an artefact whose correctness depends on an
 * environment variable cannot be committed once. A deployment's manifests are
 * discovered at runtime by `discoverOverlayModuleManifests`, which
 * `resolvedManifestEntries()` now merges on top of this index — one
 * implementation of "the deployment-resolved manifest set" rather than two, of
 * which the one under test was not the one that ran.
 */
function discoverManifests(
  packages: readonly ModulePackage[] = modulePackages(),
  // `null` is an instance: there is no application tree to walk, and that is a
  // different statement from "the walk found nothing" (see
  // {@link ApplicationModules}).
  application: ApplicationModules | null = {
    modulesRoot,
    resident: residentModules(),
  },
): DiscoveredManifest[] {
  const byId = new Map<string, DiscoveredManifest>();
  const entryFrom = (
    id: string,
    source: string,
    importPath: string,
    // The module's own root — where a manifest-declared asset directory hangs
    // off. It is the package directory for a packaged module and the manifest
    // file's own directory for one in the application tree, which is the same
    // anchor `dirname(manifestPath)` gives the running platform.
    moduleRoot: string,
    // The manifest file itself — what the reference-page renderer imports, and
    // deliberately not `importPath`; see {@link DiscoveredManifest.manifestPath}.
    manifestPath: string,
  ): DiscoveredManifest => ({
    id,
    importPath,
    docsRoot: docsRootOf(id, source, moduleRoot),
    manifestPath,
    declaresNoDocs: docsDeclarationIn(source) === false,
    hasInstallHook: detectHookExport('installHook', source, id),
    hasUninstallHook: detectHookExport('uninstallHook', source, id),
    // Feature 080, T036a / D-159 — a module's interest in *every other*
    // module's install, wired by the same walk and the same detector.
    hasLifecycleParticipant: detectHookExport('lifecycleParticipant', source, id),
    // Feature 080, T042b / D-160.9 — the operator commands a module declares
    // and the host runs, wired by the same walk and the same detector.
    hasCliCommands: detectHookExport('cliCommands', source, id),
    // Feature 080, T042j / D-163.1 — the module's declaration that its activity
    // is eligible for the dashboard's recent-activity card. Same walk, same
    // detector, so a packaged module declares one on core's terms.
    hasRecentActivity: detectHookExport('recentActivity', source, id),
  });
  // The index sits at the source root (D-160.3), so every specifier it emits
  // for a file of this application is computed from the two paths rather than
  // written as a shape — the same reason `manifestLocationsSpecifier` is.
  const applicationModulesRoot = application === null ? null : application.modulesRoot;
  for (const id of applicationModulesRoot === null ? [] : directoriesIn(applicationModulesRoot)) {
    const manifestPath = join(applicationModulesRoot!, id, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    const source = readFileSync(manifestPath, 'utf8');
    if (!/export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(source)) continue;
    byId.set(
      id,
      entryFrom(
        id,
        source,
        srcSpecifier(manifestPath),
        join(applicationModulesRoot!, id),
        manifestPath,
      ),
    );
  }
  for (const host of application?.resident ?? []) {
    byId.set(
      host.id,
      entryFrom(
        host.id,
        readFileSync(host.manifestPath, 'utf8'),
        host.specifierFor(host.manifestPath),
        dirname(host.manifestPath),
        host.manifestPath,
      ),
    );
  }
  // A packaged module's manifest is imported by the **bare** specifier its own
  // exports map publishes (D-149), so this artefact does not change on the day
  // the package stops being a workspace member and starts being installed.
  for (const pkg of packages) {
    const entry = packageEntryPoints(pkg);
    byId.set(
      pkg.moduleId,
      entryFrom(
        pkg.moduleId,
        readFileSync(entry.manifestPath, 'utf8'),
        entry.manifestSpecifier,
        // The **package** directory, not the manifest file's: a module
        // package's `docs/` sits at the package root beside `i18n/`, outside
        // `src/`, and travels in the `files` list
        // (`module-documentation-layer.md` R1.2, R1.3).
        pkg.dir,
        entry.manifestPath,
      ),
    );
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function emitManifestIndex(manifests: readonly DiscoveredManifest[]): string {
  const imports = manifests
    .map((m, i) => {
      const named = [`manifest as manifest${i}`];
      if (m.hasInstallHook) named.push(`installHook as installHook${i}`);
      if (m.hasUninstallHook) named.push(`uninstallHook as uninstallHook${i}`);
      if (m.hasLifecycleParticipant) {
        named.push(`lifecycleParticipant as lifecycleParticipant${i}`);
      }
      if (m.hasCliCommands) named.push(`cliCommands as cliCommands${i}`);
      if (m.hasRecentActivity) named.push(`recentActivity as recentActivity${i}`);
      return `import { ${named.join(', ')} } from '${m.importPath}';`;
    })
    .join('\n');

  const entries = manifests
    .map((m, i) => {
      const fields = [
        `id: '${m.id}'`,
        `manifest: manifest${i}`,
        `manifestPath: resolveManifestPath(import.meta.url, '${m.importPath}')`,
      ];
      if (m.hasInstallHook) fields.push(`installHook: installHook${i}`);
      if (m.hasUninstallHook) fields.push(`uninstallHook: uninstallHook${i}`);
      if (m.hasLifecycleParticipant) {
        fields.push(`lifecycleParticipant: lifecycleParticipant${i}`);
      }
      if (m.hasCliCommands) fields.push(`cliCommands: cliCommands${i}`);
      if (m.hasRecentActivity) fields.push(`recentActivity: recentActivity${i}`);
      return `  { ${fields.join(', ')} },`;
    })
    .join('\n');

  return `${HEADER('generate-composer.ts')}//
// The manifest registry — the **only** file that imports a **core** module's
// manifest. Every core module that ships a lifecycle-shape \`manifest.ts\` is
// here, with the lifecycle exports it declares — its install hooks and its
// lifecycle participant.
//
// Each entry also carries \`manifestPath\`: the **real** location of the file
// this entry imported its manifest from, resolved against this file's own
// \`import.meta.url\` at load time (feature 080, T041a). It is emitted data
// because the generator walked the tree and knows where each module is, while
// its one consumer — \`registered-manifests.ts\` — used to compute it from a
// convention (\`<modules root>/<id>/manifest.ts\`) that a packaged module breaks
// silently: every reader takes \`dirname\` of it to find the module's \`i18n/\`
// bundles, and the reconciler logs and skips a directory that is not there.
//
// Bare core under every value of \`DEPLOYMENT\` (D-104). A deployment's overlay
// manifests are discovered at runtime and merged on top of this index by
// \`resolvedManifestEntries()\`, because which deployment a build is depends on
// the process rather than on the tree this file was generated from.
//
// It used to have a twin (\`registered-manifests.ts\`) importing the same
// manifests behind a second command, which is a drift waiting to happen; that
// file now derives its entries from this array instead.
//
// Order is alphabetical and no consumer depends on it:
// \`collectRegisteredSettingsManifests()\` re-imposes its own (settings first,
// because every other module's settings fall back to its \`general\` group), and
// everything else topo-sorts or set-ifies.

import type { ModuleManifest, ModuleManifestExports } from '@endora-commerce/contracts';
import { resolveManifestPath } from '${manifestLocationsSpecifier}';

${imports}

export interface DiscoveredManifestEntry {
  id: string;
  manifest: ModuleManifest;
  /**
   * The real path of the file this entry's manifest was imported from —
   * \`<module>/manifest.ts\` in the application tree, \`<package>/package.json\`
   * for a packaged module. Every consumer takes \`dirname\` of it.
   */
  manifestPath: string;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
  lifecycleParticipant?: ModuleManifestExports['lifecycleParticipant'];
  cliCommands?: ModuleManifestExports['cliCommands'];
  recentActivity?: ModuleManifestExports['recentActivity'];
}

export const DISCOVERED_MANIFESTS: ReadonlyArray<DiscoveredManifestEntry> = [
${entries}
];
`;
}

/** Pure render — the target path + expected content of the manifest registry. */
export function renderManifestIndex(
  packages: readonly ModulePackage[] = modulePackages(),
): { outputPath: string; content: string } {
  return {
    outputPath: manifestIndexOutputPath,
    content: emitManifestIndex(discoverManifests(packages)),
  };
}

// ── the two db/ registries ──────────────────────────────────────────────────
//
// Both are derived from one input: every `.ts` under `src/`, keyed by its
// `src`-relative path. The collectors take that map rather than reading the
// disk so each way the tree can be wrong is drivable on synthetic input
// (`test/unit/scripts/generate-registries.test.ts`) — a generator whose walk
// silently narrows emits a shorter list, and a shorter list of migrations is a
// table that is never created.

/**
 * One source file the generator read, and where it came from.
 *
 * The origin is carried on the **value** rather than encoded in the key
 * (feature 080, T041a). A key alone cannot answer it: `src/packages/…` and
 * `packages/modules/…/…` are both plausible strings, the second has to be
 * attributed to a module id that is not in its path, and a specifier for it is
 * derived from a manifest the key knows nothing about. A discriminated value
 * makes every one of those a field lookup instead of a parse.
 */
export interface SourceFile {
  readonly text: string;
  /** The module package that owns it, or `null` for the application's own tree. */
  readonly owner: ModulePackage | null;
}

/**
 * Every hand-written `.ts` source the generator read.
 *
 * Keyed by `src`-relative path for the application's tree, and by
 * package-relative path for a module package's — the two are only ever compared
 * with an origin in hand, so they do not share a namespace.
 */
export type SourceTree = ReadonlyMap<string, SourceFile>;

/** A `SourceTree` of application sources, for a test that only needs those. */
export function coreSources(files: Readonly<Record<string, string>>): SourceTree {
  return new Map(Object.entries(files).map(([file, text]) => [file, { text, owner: null }]));
}

/** A `SourceTree` of one module package's sources. */
export function packageSources(
  pkg: ModulePackage,
  files: Readonly<Record<string, string>>,
): SourceTree {
  return new Map(Object.entries(files).map(([file, text]) => [file, { text, owner: pkg }]));
}

/** Two trees, in one map. Later entries win, as `Map` does. */
export function mergeSources(...trees: readonly SourceTree[]): SourceTree {
  const merged = new Map<string, SourceFile>();
  for (const tree of trees) for (const [file, entry] of tree) merged.set(file, entry);
  return merged;
}

/**
 * A generated artefact is **output, not input**. Excluding `*.generated.ts` is
 * not tidiness: the emitted registries quote the decorators and paths they
 * scanned for, so reading them back made the second run of the generator
 * disagree with the first — which is the one property a committed artefact must
 * never lack.
 */
function readTree(
  root: string,
  owner: ModulePackage | null,
  prefix = '',
  out = new Map<string, SourceFile>(),
  skipTopLevel: ReadonlySet<string> = new Set(),
): Map<string, SourceFile> {
  for (const name of readdirSync(root).sort()) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    if (prefix === '' && skipTopLevel.has(name)) continue;
    const full = join(root, name);
    const relativePath = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) {
      readTree(full, owner, relativePath, out, skipTopLevel);
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.d.ts') &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.generated.ts')
    ) {
      out.set(relativePath, { text: readFileSync(full, 'utf8'), owner });
    }
  }
  return out;
}

/**
 * The application's own sources — the platform's read where they now live —
 * plus every module package's.
 *
 * The package half is what makes the two `db/` registries survive the layout
 * move: an entity or a migration that has become a package's is read here, is
 * attributed to its package's declared module id, and is emitted with a bare
 * specifier. Without it the walk narrows silently and a migration stops running
 * — which is the exact failure the registries were consolidated to prevent.
 *
 * **The platform is the one tree read from outside `src/` and keyed inside it**
 * (the relocation, D-160/D-164/D-165). Its five directories moved into
 * `@endora-commerce/platform` and left re-export shims at their old paths, so a
 * plain walk of `src/` would find six `*.entity.ts` files carrying no decorator
 * — the generator's own "either the decorator is missing or the file is
 * misnamed" refusal, raised on files that are neither — and would drop
 * `sales_channels`, `settings`, `audit_logs` and `module_registrations` from the
 * entity registry. Reading the package's `src` under the same five keys keeps
 * the tree exactly what it was, which is why the committed artefacts do not move
 * a byte.
 *
 * The **owner** stays `null` and the emitted specifier therefore stays relative,
 * naming the shim rather than a bare subpath. That is deliberate and it is not
 * the D-149 case: a module package's entity is named bare because the artefact
 * must survive that package ceasing to be a workspace member, while the host is
 * a peer every instance already has one of, two of its six entity classes are
 * off the published barrels by ruling (`ModuleRegistration` is **A** in
 * host-package.md §1.3), and a deep bare specifier is exactly what D-160.7's
 * enumerated `exports` map refuses. The shim forwards to the package's build
 * output, so the class in the registry is the class the package exports.
 */
function readSourceTree(packages: readonly ModulePackage[] = modulePackages()): SourceTree {
  const platformRoot = platformSourceRootAt(repoRoot);
  if (platformRoot === null) {
    throw new PlatformRootUnresolvableError(
      'no workspace member declares `endora.type: "platform"`. Six persisted entity classes ' +
        'live there — a walk without it emits an entity registry missing `sales_channels`, ' +
        '`settings`, `audit_logs` and `module_registrations`, and the schema it produces is ' +
        'wrong rather than absent.',
    );
  }
  const out = readTree(
    srcRoot,
    null,
    '',
    new Map<string, SourceFile>(),
    new Set(platformSubpathsAt(repoRoot)),
  );
  readTree(platformRoot, null, '', out);
  for (const pkg of packages) readTree(pkg.dir, pkg, '', out);
  return out;
}

/**
 * Import specifier from a file in `src/db/` to a source file (D-149).
 *
 * Relative for the application's own tree — `./entities-registry.generated.js`
 * for a sibling under `db/`, `../modules/blog/…` for anything else — and **bare** for
 * a module package, which is what keeps the artefact unchanged on the day that
 * package stops being a workspace member and starts being installed. The bare
 * form is derived from the package's own `exports` map rather than assembled
 * from a subpath written here; see `lib/module-packages.ts`.
 */
function specifierFor(file: string, owner: ModulePackage | null): string {
  if (owner !== null) return packageSpecifierFor(owner, file);
  // The platform's own migrations are named through the subpath that publishes
  // them, not through a relative path (`specs/110-instance-repository/` T116).
  // Every other platform file the registries name stays relative and lands on a
  // re-export shim, which is this function's paragraph above and unchanged:
  // **one** of the six platform entity classes is off the published barrels by
  // ruling — `ModuleRegistration`, **A** in host-package.md §1.3 — so an address
  // for it would be a widening D-160.7 refuses, and the registry names all six
  // the one way that works for all six. (This comment read *two* until
  // `specs/110-instance-repository/` T119 measured it: `AuditLogEntry`,
  // `SalesChannel`, `Setting`, `SettingGroup` and `SettingValue` are all on
  // `./kernel` today. The behaviour is unaffected — one class with no address is
  // as binding as two — which is exactly why nobody re-derived the count.)
  // Those five shims are therefore held open by this function alone, and they
  // retire when it learns to name the barrel where there is one; T119 left them
  // rather than teach a generator a per-symbol conditional in a drain.
  // A migration class carries none of that — `mikro_orm_migrations` persists the
  // name, the `./migrations` barrel carries all twelve, and a relative specifier
  // here would need twelve shims in a directory the application no longer owns.
  if (CORE_MIGRATION_RE.test(file)) return platformSpecifier(PLATFORM_MIGRATION_SUBPATH);
  const asJs = file.replace(/\.ts$/, '.js');
  return asJs.startsWith('db/') ? `./${asJs.slice('db/'.length)}` : `../${asJs}`;
}

/**
 * `<the platform's package name>/<subpath>`, read off the workspace rather than
 * spelled: one member declares `endora.type: "platform"` and its name is what a
 * consumer's bare specifier has to be (D-100).
 */
function platformSpecifier(subpath: string): string {
  const name = platformPackageNameOf(workspaceMembers(repoRoot, nodeWorkspaceFs()));
  if (name === null) {
    throw new PlatformRootUnresolvableError(
      'no workspace member declares `endora.type: "platform"`, so the twelve core ' +
        'migrations have no specifier. A registry that omitted them would leave a fresh ' +
        'database with no `settings`, no `module_registrations` and no `sales_channels`.',
    );
  }
  return `${name}/${subpath}`;
}

/** One `@Entity`-decorated class, as the generator sees it. */
export interface DiscoveredEntity {
  readonly className: string;
  /** Path of the file declaring it, relative to its own root. */
  readonly file: string;
  /** The module package that owns it, or `null` for the application's tree. */
  readonly owner: ModulePackage | null;
}

/**
 * Every persisted entity in the core tree.
 *
 * Detection is by the **decorator**, not by the `.entity.ts` suffix. Nothing
 * enforces that suffix, so a suffix-scoped walk reports a complete registry for
 * an entity declared in a file next door — the same narrowing
 * `check-entity-tenant-classification.ts` was widened away from. The suffix is
 * still checked, in the other direction: a `.entity.ts` file with no decorator
 * is either a dropped decorator or a misnamed file, and both are worth saying.
 */
export function collectEntities(sources: SourceTree): DiscoveredEntity[] {
  const found: DiscoveredEntity[] = [];
  const byClassName = new Map<string, string>();
  for (const [file, { text: source, owner }] of [...sources].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const declares = source.includes('@Entity(');
    if (!declares) {
      if (file.endsWith('.entity.ts')) {
        throw new Error(
          `[composer] ${file} declares no @Entity() class. Either the decorator is missing ` +
            `or the file is misnamed; an entity the registry does not carry is absent from ` +
            `the ORM metadata and fails at the first query.`,
        );
      }
      continue;
    }
    if (owner === null && file.startsWith('apps/')) {
      throw new Error(
        `[composer] ${file} declares an @Entity() class under a deployment overlay. ` +
          `A per-deployment overlay contributes registrations, routes, decorations, ` +
          `interceptors, permissions, i18n and a manifest — and no schema (D-106, narrowing ` +
          `D-105). The reason is not migration ordering: that argument was measured false ` +
          `and is retired. It is that an overlay lives in the same repository and the same ` +
          `build as core, so the remedy is always available and costs nothing but a ` +
          `directory. Delete this file's directory and ship the table from a core module; ` +
          `the overlay module keeps its services, routes and decorations and reads the core ` +
          `module's port. An extension package is the opposite case and may ship schema — a ` +
          `third-party author has no core module to ship it from.`,
      );
    }
    let cursor = source.indexOf('@Entity(');
    while (cursor !== -1) {
      const match = /export\s+class\s+(\w+)/.exec(source.slice(cursor));
      const className = match?.[1];
      if (className === undefined) {
        throw new Error(
          `[composer] ${file} declares @Entity() but the class it decorates could not be read. ` +
            `Write it as 'export class <Name>' directly below the decorator.`,
        );
      }
      const previous = byClassName.get(className);
      if (previous !== undefined) {
        throw new Error(
          `[composer] two entities are called '${className}' (${previous} and ${file}). ` +
            `The registry is a flat list of classes, so the second would shadow the first.`,
        );
      }
      byClassName.set(className, file);
      found.push({ className, file, owner });
      cursor = source.indexOf('@Entity(', cursor + 1);
    }
  }
  return found;
}

function emitEntitiesHeader(): string {
  return `${HEADER('generate-composer.ts')}//
// The entity registry \`mikro-orm.config.ts\` discovers through.
//
// Explicit classes rather than a glob: glob discovery needs a runtime dynamic
// \`import()\` of a \`.ts\` file, which Node's ESM loader cannot transform and which
// breaks under Vitest. Listing them side-steps that — and since feature 071's F2
// the list is a filesystem walk rather than 219 imports someone kept in sync by
// hand, so adding an entity is adding a file and removing a module is deleting
// its directory.
//
// Every class carrying the MikroORM entity decorator anywhere under \`src/\` is
// here, in path order. Detection is by that decorator, not by the
// \`.entity.ts\` suffix, because nothing enforces the suffix — and the decorator
// is deliberately not spelled out in this comment, so that a walk looking for
// it does not find its own output. A per-deployment overlay contributes no
// schema (D-106), so an entity under \`src/apps/\` is refused by the generator
// rather than registered for a table nothing creates. A **module package** is
// the opposite case and is here: its entities are named by a bare specifier
// derived from that package's own \`exports\` map (D-149), and they arrive as
// **one \`entities\` array** rather than as a class per name (D-168) — the same
// export \`src/packages/package-runtime.ts\` reads when that package is
// installed rather than linked, so the committed registry and the runtime
// loader now read one declaration instead of two.
`;
}

/**
 * A module id as an identifier — `quote_requests` → `quoteRequests`.
 *
 * The binding a package's `entities` array is imported under. Derived rather
 * than spelled, because the id is the package's own (D-142) and nothing here
 * may assume its shape beyond `check:naming`'s snake_case rule.
 */
function bindingBaseFor(moduleId: string): string {
  const segments = moduleId.split(/[^A-Za-z0-9]+/).filter((segment) => segment.length > 0);
  const [head, ...tail] = segments;
  if (head === undefined) {
    throw new Error(
      `[composer] module id '${moduleId}' yields no identifier, so its entities array cannot ` +
        `be imported under a name.`,
    );
  }
  return (
    (/^\d/.test(head) ? `module${head}` : head) +
    tail.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join('')
  );
}

/**
 * Pure emit — the entity registry's content for a given set of entities.
 *
 * Two shapes, and the split is D-168. The application's own tree is named class
 * by class, because there is no `exports` map between the registry and the file.
 * A **module package** publishes one `entities` array on its `./backend`
 * subpath and no entity class by name, so it is imported once and spread —
 * eleven lines become one for `blog`. The spread lands at the position the
 * package's first entity held, which keeps the rest of the list byte-identical
 * and keeps the order a path-ordered walk produced.
 */
export function emitEntitiesRegistry(entities: readonly DiscoveredEntity[]): string {
  const importLines: string[] = [];
  const listed: string[] = [];
  const specifierByModule = new Map<string, string>();
  const emitted = new Set<string>();
  let needsEntityClassLike = false;

  for (const entity of entities) {
    if (entity.owner === null) {
      importLines.push(
        `import { ${entity.className} } from '${specifierFor(entity.file, null)}';`,
      );
      listed.push(`  ${entity.className},`);
      continue;
    }
    const specifier = specifierFor(entity.file, entity.owner);
    const previous = specifierByModule.get(entity.owner.moduleId);
    if (previous !== undefined && previous !== specifier) {
      throw new Error(
        `[composer] ${entity.owner.name} publishes entities behind two subpaths ` +
          `('${previous}' and '${specifier}'). D-168 makes a module package's entities one ` +
          `\`entities\` array on one declared subpath: a second one is a second array, and ` +
          `the registry cannot import a class by name from either.`,
      );
    }
    specifierByModule.set(entity.owner.moduleId, specifier);
    if (emitted.has(entity.owner.moduleId)) continue;
    emitted.add(entity.owner.moduleId);
    needsEntityClassLike = true;
    const binding = `${bindingBaseFor(entity.owner.moduleId)}Entities`;
    importLines.push(`import { entities as ${binding} } from '${specifier}';`);
    // The cast is D-168 arriving in the type system, and it is load-bearing
    // rather than cosmetic. `as const` infers a tuple, and the package's element
    // types are its entity classes — which it deliberately no longer exports by
    // name, so `tsc` cannot write them into this file's `.d.ts` and raises
    // TS2742 ("cannot be named without a reference to
    // <package>/dist/backend/entities/…"). Widening the spread to the shape the
    // *runtime* loader produces is the honest answer: the committed registry and
    // `package-runtime.ts` then agree on one type for a package's entities, and
    // the application's own classes keep their precise ones.
    listed.push(`  ...(${binding} as readonly EntityClassLike[]),`);
  }

  const typeImport = needsEntityClassLike
    ? `import type { EntityClassLike } from '../packages/package-runtime.js';\n`
    : '';

  return `${emitEntitiesHeader()}
${typeImport}${importLines.join('\n')}

export const ALL_ENTITIES = [
${listed.join('\n')}
] as const;
`;
}

/** Pure render — the target path + expected content of the entity registry. */
export function renderEntitiesRegistry(sources: SourceTree = readSourceTree()): {
  outputPath: string;
  content: string;
} {
  return {
    outputPath: entitiesRegistryOutputPath,
    content: emitEntitiesRegistry(collectEntities(sources)),
  };
}

/**
 * contracts/naming-convention.md §1 — the only recognizer any tool may use.
 * `test/unit/db/migrations-registry.test.ts` deliberately keeps its own copy:
 * the round trip is worth something only when the two implementations are
 * independent.
 */
const MIGRATION_FILE_RE = /^(\d{8}T\d{6})_([a-z0-9_]+)\.ts$/;

/**
 * contracts/naming-convention.md §4 — non-migration helpers in a migrations/ dir.
 *
 * Keyed `<package name>:<package-relative path>` for a module package's file and
 * by the bare `src`-relative path for the application's own tree, because
 * {@link SourceTree}'s two key namespaces are only ever compared with an origin
 * in hand and `src/migrations/status-mapping.ts` is the same string in every
 * package.
 *
 * **This is not the exemption `isDeclaredEntryPoint` refused to be** (D-100).
 * That one is the `./migrations` **barrel**, which every package has by
 * construction, so listing it would be one entry per package — a derived fact
 * written down, and it is derived from the package's own `exports` map instead.
 * §4's helper is the opposite shape: the whole tree has exactly one, it is not
 * implied by anything, and no package acquires one by existing. A list of the
 * things that are genuinely exceptional is what an allow-list is for.
 *
 * The refusal it steps around is unchanged in force: a `.ts` in a migrations
 * directory that is named like nothing is still refused, packaged or not,
 * because skipping one is how a migration goes missing without a word.
 */
const MIGRATION_HELPER_ALLOW_LIST = new Set([
  '@endora-commerce/mod-quote-requests:src/migrations/status-mapping.ts',
]);

/** How {@link MIGRATION_HELPER_ALLOW_LIST} is keyed for a file of either origin. */
function migrationHelperKey(owner: ModulePackage | null, file: string): string {
  return owner === null ? file : `${owner.name}:${file}`;
}

/** contracts/naming-convention.md §2 — the name `mikro_orm_migrations` persists. */
function classNameFromMigrationFile(filename: string): string {
  const match = MIGRATION_FILE_RE.exec(filename);
  if (!match) throw new Error(`[composer] unexpected migration filename: ${filename}`);
  const tail = match[2]!
    .split('_')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `Migration${match[1]}${tail}`;
}

/** One migration file, as the generator sees it. */
export interface DiscoveredMigration {
  /** Owning module id — `core` for the platform's own `migrations/`. */
  readonly moduleId: string;
  readonly className: string;
  /** Path of the migration file, relative to its own root. */
  readonly file: string;
  /** The module package that owns it, or `null` for the application's tree. */
  readonly owner: ModulePackage | null;
}

/**
 * The platform's own migrations and the application's module-owned ones.
 *
 * `CORE_MIGRATION_RE` reads `migrations/<file>` at the **top level of a source
 * root**, which since `specs/110-instance-repository/` T116 can only be the
 * platform's tree: the twelve cross-cutting migrations moved to
 * `packages/platform/src/migrations/` beside the `./migrations` barrel that
 * publishes them, and `backend/src/` has no top-level `migrations/` directory
 * (`./migrations` is a declared platform subpath, so the application walk would
 * skip one). They keep the module id `core`, keep their filenames and keep their
 * class names — R7.5: `mikro_orm_migrations` persists the class name, so a
 * rename makes every existing database see the migration as pending.
 */
const PLATFORM_MIGRATION_SUBPATH = 'migrations';
const CORE_MIGRATION_RE = new RegExp(`^${PLATFORM_MIGRATION_SUBPATH}/([^/]+\\.ts)$`);
const MODULE_MIGRATION_RE = /^modules\/([^/]+)\/migrations\/([^/]+\.ts)$/;
const OVERLAY_MIGRATION_RE = /^apps\/[^/]+\/modules\/[^/]+\/migrations\//;

/**
 * A migration inside a module package — `<anything>/migrations/<file>`.
 *
 * Deliberately **not** anchored on a `modules/<id>/` segment the way its
 * application twin is, and the module id is **not** read out of it: a package's
 * layout is its own (`src/migrations/`, per `module-package-layout.md` §1) and
 * its id comes off its `endora` block, which is the declaration D-142 makes
 * authoritative. Keying on the path would work for one layout and stop working
 * for the next, which is the failure `lib/module-roots.ts` exists to end rather
 * than relocate.
 */
const PACKAGE_MIGRATION_RE = /(?:^|\/)migrations\/([^/]+\.ts)$/;

/**
 * Every migration in the core tree, with the module that owns it.
 *
 * The class name is **derived from the filename** and is the name
 * `mikro_orm_migrations` persists, so the generator asserts the file actually
 * exports it rather than guessing: a name that drifted would make every
 * database that already ran the migration see it as pending and re-apply it.
 *
 * An unrecognized `.ts` in a migrations directory is refused rather than
 * skipped. Skipping is how a migration goes missing without a word — the exact
 * failure the registry exists to prevent.
 */
export function collectMigrations(
  sources: SourceTree,
  helperAllowList: ReadonlySet<string> = MIGRATION_HELPER_ALLOW_LIST,
): DiscoveredMigration[] {
  const found: DiscoveredMigration[] = [];
  const byClassName = new Map<string, string>();
  for (const [file, { text: source, owner }] of [...sources].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (owner === null && OVERLAY_MIGRATION_RE.test(file)) {
      throw new Error(
        `[composer] ${file} is a migration under a deployment overlay. A per-deployment ` +
          `overlay contributes registrations, routes, decorations, interceptors, ` +
          `permissions, i18n and a manifest — and no schema (D-106, narrowing D-105). The ` +
          `reason is not migration ordering: that argument was measured false and is ` +
          `retired. It is that an overlay lives in the same repository and the same build ` +
          `as core, so the remedy is always available and costs nothing but a directory — ` +
          `move the schema into a core module. Registering this file here would be a new ` +
          `capability, not a side effect of generating the list. An extension package is ` +
          `the opposite case and may ship migrations — a third-party author has no core ` +
          `module to ship them from.`,
      );
    }
    const packaged = owner !== null ? PACKAGE_MIGRATION_RE.exec(file) : null;
    const core = owner === null ? CORE_MIGRATION_RE.exec(file) : null;
    const owned = owner === null ? MODULE_MIGRATION_RE.exec(file) : null;
    if (!core && !owned && !packaged) continue;
    // The id of a packaged migration is its package's declared `endora.id`, not
    // a path segment (D-142); of an application one, the directory it sits in.
    const moduleId = packaged ? owner!.moduleId : core ? 'core' : owned![1]!;
    const filename = packaged ? packaged[1]! : core ? core[1]! : owned![2]!;
    if (!MIGRATION_FILE_RE.test(filename)) {
      if (helperAllowList.has(migrationHelperKey(owner, file))) continue;
      // The platform's `./migrations` barrel, on `isDeclaredEntryPoint`'s own
      // reasoning one tree over: the subpath has to name a file, that file is
      // the barrel re-exporting the classes, and the name comes off
      // `barrelKeyOf` rather than being spelled here (D-100).
      if (owner === null && core && file === barrelKeyOf(PLATFORM_MIGRATION_SUBPATH)) continue;
      // A package's `./migrations` subpath has to name a file, and that file is
      // the barrel re-exporting the classes — declared, not merely present, so
      // the exemption is derived from the package's own `exports` map instead of
      // growing §4's allow-list by one entry per package (D-100).
      if (owner !== null && isDeclaredEntryPoint(owner, file)) continue;
      throw new Error(
        `[composer] ${file} sits in a migrations directory but is not named like a ` +
          `migration (<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts). Rename it per ` +
          `specs/065-manifest-aware-migrations/contracts/naming-convention.md §1, or add it ` +
          `to the helper allow-list in this generator. It is not registered as written, and ` +
          `an unregistered migration does not run.`,
      );
    }
    const className = classNameFromMigrationFile(filename);
    if (!new RegExp(`export\\s+class\\s+${className}\\b`).test(source)) {
      throw new Error(
        `[composer] ${file} must export 'class ${className}' — the class name is derived ` +
          `from the filename and is what \`mikro_orm_migrations\` persists. Rename the class ` +
          `to match the file, not the other way round.`,
      );
    }
    const previous = byClassName.get(className);
    if (previous !== undefined) {
      throw new Error(
        `[composer] two migrations resolve to '${className}' (${previous} and ${file}). ` +
          `The persisted name would collide, so one of the two would never run.`,
      );
    }
    byClassName.set(className, file);
    found.push({ moduleId, className, file, owner });
  }
  return found;
}

function emitMigrationsHeader(): string {
  return `${HEADER('generate-composer.ts')}//
// The single registration point for every migration in the repository.
//
// Static imports only — no glob, no dynamic \`import()\`: Node's ESM loader
// cannot transform \`.ts\` at runtime and it breaks under Vitest (the same reason
// ./entities-registry.generated.ts exists). A migration that is not registered
// here does not run; since feature 071's F2 registration is a filesystem walk
// rather than a line someone remembers to paste, and the round-trip guard in
// test/unit/db/migrations-registry.test.ts fails the build on a stale artefact.
//
// **Declaration order has no effect on execution order.** That is computed by
// migration-order.ts: the frozen historical prefix marked by BASELINE_THROUGH,
// then module by module in a topological order of the manifest dependency
// graph, each module's migrations contiguous and ascending by timestamp. A
// timestamp orders a module's own migrations and nothing else. Entries below
// are grouped by owning module purely so the diff reads; never "fix" an
// ordering surprise by moving a line, and there is nothing to move —
// regenerating restores it. Fix the manifest \`dependencies\` instead; a
// timestamp cannot fix a cross-module position.
//
// The \`moduleId\` is load-bearing beyond ordering: a hard uninstall reverts
// exactly the migrations registered under the module being removed
// (\`_lifecycle/services/orchestrator.ts\`). It is the directory the file lives
// in, which for kernel-owned tables is \`core\` —
// test/unit/db/kernel-migration-ownership.test.ts enforces that the tables a
// migration writes to agree with it.
//
// Add one with: pnpm --filter backend run migration:new -- --module <id> --name <slug>
`;
}

/** Pure emit — the migration registry's content for a given set of migrations. */
export function emitMigrationsRegistry(migrations: readonly DiscoveredMigration[]): string {
  const grouped = [...migrations].sort(
    (a, b) => a.moduleId.localeCompare(b.moduleId) || a.file.localeCompare(b.file),
  );
  const sections: string[] = [];
  const imports: string[] = [];
  let currentModule: string | null = null;
  for (const entry of grouped) {
    if (entry.moduleId !== currentModule) {
      currentModule = entry.moduleId;
      const rule = '─'.repeat(Math.max(1, 72 - currentModule.length));
      sections.push(`\n  // ── ${currentModule} ${rule}`);
      imports.push(`\n// ── ${currentModule} ${rule}`);
    }
    imports.push(`import { ${entry.className} } from '${specifierFor(entry.file, entry.owner)}';`);
    sections.push(`  migration('${entry.moduleId}', ${entry.className}),`);
  }

  return `${emitMigrationsHeader()}
import type { MigrationClass, MigrationRegistryEntry } from '@endora-commerce/platform/db';
${imports.join('\n')}

export type { MigrationClass, MigrationRegistryEntry };

/** One-line helper: the migration name is always \`cls.name\`, never hand-written. */
function migration(moduleId: string, cls: MigrationClass): MigrationRegistryEntry {
  return { moduleId, cls };
}

export const MIGRATION_REGISTRY: readonly MigrationRegistryEntry[] = [${sections.join('\n')}
];
`;
}

/** Pure render — the target path + expected content of the migration registry. */
export function renderMigrationsRegistry(sources: SourceTree = readSourceTree()): {
  outputPath: string;
  content: string;
} {
  return {
    outputPath: migrationsRegistryOutputPath,
    content: emitMigrationsRegistry(collectMigrations(sources)),
  };
}


// ── the published baseline list ─────────────────────────────────────────────
//
// The eighth artefact (`specs/110-instance-repository/`, T161). It is the only
// one that does not land under `backend/`: the frozen historical prefix is data
// about *this platform's* history, a client receives it by installing the
// platform, and a client receives a correction to it by `pnpm update` (R1.5).
//
// It exists because membership of that prefix used to be decided on
// `origin === 'core'`, which answers *"came out of this repository's build"* —
// true of every module while the modules are compiled in, false of every module
// the moment one is installed. Measured over the real registry: the prefix falls
// from 112 entries to 11 and 181 of 182 positions move, so an instance
// installing the same modules cannot migrate a fresh database. Membership is now
// by identity, and this is the identity list.

/**
 * Where the published baseline list lands, inside the platform package.
 *
 * The host's source root is derived from the workspace member declaring
 * `endora.type: "platform"` — `platformSourceRootAt`, the same resolution the
 * manifest walk above uses — so `packages/platform` is spelled nowhere (D-100).
 * A workspace with no such member is a **refusal** rather than a skip: an
 * artefact written to a guessed location, or quietly not written at all, is one
 * no determinism gate would ever compare.
 */
function baselineListOutputPath(): string {
  const platformRoot = platformSourceRootAt(repoRoot);
  if (platformRoot === null) {
    throw new PlatformRootUnresolvableError(
      '[composer] no workspace member declares `endora.type: "platform"`, so the published ' +
        'baseline list has no home. It is the host package\'s (R1.5): a client receives the ' +
        'frozen historical prefix by installing the platform, and a correction to it by ' +
        '`pnpm update`.',
    );
  }
  return join(platformRoot, 'migrations', 'baseline-migrations.generated.ts');
}

/**
 * Pure emit — the published baseline list for a given set of migration names.
 *
 * The order is {@link historicalBaselineOrder}'s, which is `orderMigrations`'
 * own: one derivation, so the artefact cannot come to disagree with the
 * algorithm that reads it. R1.4 — the list is closed and cannot grow, because
 * `migration:new` clamps every scaffolded stamp past the watermark, so a name
 * below it that is not already here cannot be produced.
 */
export function emitBaselineList(names: readonly string[]): string {
  const baseline = historicalBaselineOrder(names, BASELINE_THROUGH);
  return `${HEADER('generate-composer.ts')}//
// The frozen historical prefix, by identity — every migration whose position is
// history rather than a consequence of the manifest graph, in the order history
// applied it.
//
// Normative: specs/110-instance-repository/contracts/instance-migration-order.md.
// The reason it is the platform's, and the reason membership is a name rather
// than an origin, are in ./index.ts. The reason it may not be recomputed from
// the manifest graph is BASELINE_THROUGH's own doc block: that block predates
// feature 065, its modules' \`dependencies\` arrays contradict the order it was
// applied in in 37 places, and re-deriving it produces an order a fresh database
// cannot apply.
//
// **Closed. It never grows** (R1.4): it holds what the committed core registry
// contributes at or below BASELINE_THROUGH (${BASELINE_THROUGH}), and
// \`migration:new\` clamps every scaffolded stamp past that watermark. A name
// here that no registry entry supplies, and a registry entry below the watermark
// that is not named here, are both refused by
// backend/test/unit/db/instance-migration-order.test.ts.

export const BASELINE_MIGRATIONS: readonly string[] = [
${baseline.map((name) => `  '${name}',`).join('\n')}
];
`;
}

/** Pure render — the target path + expected content of the published baseline list. */
export function renderBaselineList(sources: SourceTree = readSourceTree()): {
  outputPath: string;
  content: string;
} {
  return {
    outputPath: baselineListOutputPath(),
    content: emitBaselineList(collectMigrations(sources).map((entry) => entry.className)),
  };
}


// ── the admin contribution registry ─────────────────────────────────────────
//
// The fifth artefact (feature 091, Phase 2). Its three siblings under
// `backend/src` plus the manifest index come out of the same command; this one
// is written into the **admin** application, because that is the program that
// consumes it, and its location is derived from the `"@/*"` alias exactly as
// `check:admin-surface` and `check:admin-zones` derive theirs.

/** The layer a module package publishes its admin contributions from. */
const ADMIN_LAYER = 'admin';

/** Where a module package that ships **sources** keeps that layer. */
const ADMIN_LAYER_ENTRY = `src/${ADMIN_LAYER}/index.ts`;

/** Where a module package that ships **sources** keeps them at all. */
const PACKAGE_SOURCE_ROOT = 'src';

/** One module package's admin contribution, as the artefact names it. */
export interface AdminContributionEntry {
  /** `endora.id`, the identity of record (D-142). */
  readonly moduleId: string;
  /** The bare specifier, derived from the package's own `exports` map (D-149). */
  readonly specifier: string;
}

/**
 * Every module package that ships an admin layer, sorted by module id.
 *
 * **Discovery is the package's own statement about itself** (R2): the `endora`
 * block says it is a module, and the presence of `src/admin/index.ts` says it
 * contributes. Nothing keys on a directory name and `packages/modules` is
 * spelled nowhere (D-100).
 *
 * **A module with the layer and no `./admin` subpath is refused, not skipped**
 * (R4). `packageSpecifierFor` raises `ModulePackageError` naming the file and
 * the declared subpaths, because a skip is how a whole layer goes missing
 * without a word — the same reason a packaged migration covered by no declared
 * subpath is refused rather than dropped.
 */
export function collectAdminContributions(
  packages: readonly ModulePackage[],
  exists: (path: string) => boolean = existsSync,
): readonly AdminContributionEntry[] {
  const found: AdminContributionEntry[] = [];
  for (const pkg of packages) {
    const specifier = adminLayerSpecifierOf(pkg, exists);
    if (specifier === null) continue;
    found.push({ moduleId: pkg.moduleId, specifier });
  }
  return found.sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

/**
 * The bare specifier of one package's admin layer, or `null` when it ships none.
 *
 * **Two shapes of package, one question, and the evidence decides which is
 * being asked** (`specs/110-instance-repository/` FR-005). A package this
 * repository holds ships its sources, so the layer is a source file and the
 * specifier comes from taking that file through the package's emit layout and
 * its `exports` map, exactly as it always has. A package an **instance**
 * installed ships `dist` and nothing else — its `files` list carries no `src/`
 * — so the only evidence it can offer is its own `exports` map, and the layer
 * is the subpath whose target covers a directory named {@link ADMIN_LAYER}.
 *
 * **Which question is asked is decided by the package's own declaration, not by
 * a fallback.** A package that declares a build layout — `tsconfig.build.json`,
 * which is in no published package's `files` list — ships sources and is judged
 * by its sources, full stop. Without that clause a member whose admin layer was
 * **deleted** would go on contributing out of a stale `dist/admin/`, because
 * `tsc` does not remove what it no longer emits, and the registry would name a
 * screen whose source is gone. The `src/` probe is the same statement for a
 * package that ships sources and declares no build at all.
 *
 * A source layer the `exports` map does not cover is still a refusal, and
 * `packageSpecifierFor` is what raises it (R4): a skip is how a whole layer
 * goes missing without a word.
 */
function adminLayerSpecifierOf(
  pkg: ModulePackage,
  exists: (path: string) => boolean,
): string | null {
  const shipsSources =
    pkg.emit !== null || exists(absolutePathInPackage(pkg, PACKAGE_SOURCE_ROOT));
  if (shipsSources) {
    return exists(absolutePathInPackage(pkg, ADMIN_LAYER_ENTRY))
      ? packageSpecifierFor(pkg, ADMIN_LAYER_ENTRY)
      : null;
  }
  return publishedAdminLayerSpecifierOf(pkg, exists);
}

/**
 * The declared subpath serving an installed package's admin layer, or `null`.
 *
 * The subpath's **name** is not read — a package may call it anything — and
 * neither is `dist`. What is read is where its target lands: the directory a
 * barrel covers, whose last segment is the layer's. A subpath whose target file
 * is not in the package is a **refusal**, because the registry would import it
 * and Vite would fail to resolve it at bundle time, which is a failure a client
 * cannot attribute to anything.
 */
function publishedAdminLayerSpecifierOf(
  pkg: ModulePackage,
  exists: (path: string) => boolean,
): string | null {
  for (const [subpath, target] of pkg.exports) {
    if (subpath === './package.json') continue;
    const relativePath = target.replace(/^\.\//, '');
    const directory = dirname(relativePath);
    if (directory.split('/').pop() !== ADMIN_LAYER) continue;
    if (!exists(absolutePathInPackage(pkg, relativePath))) {
      throw new ModulePackageError(
        `[composer] ${pkg.name} exports '${subpath}' as ${target}, and that file is not in ` +
          `the package. The admin registry imports the layer by that specifier, so an entry ` +
          `for it would break the bundle; dropping it instead is how a client loses a screen ` +
          `they installed with no error anywhere.`,
      );
    }
    return `${pkg.name}/${subpath.replace(/^\.\//, '')}`;
  }
  return null;
}

/** A JS identifier for one entry's import binding — `import_export` → `contributions0`. */
function adminBindingOf(index: number): string {
  return `contributions${index}`;
}

/** Pure render of the admin registry, exported so a test can drive it. */
export function emitAdminRegistry(entries: readonly AdminContributionEntry[]): string {
  const imports = entries
    .map(
      (entry, index) =>
        `import { contributions as ${adminBindingOf(index)} } from '${entry.specifier}';`,
    )
    .join('\n');
  const body = entries
    .map(
      (entry, index) =>
        `  { moduleId: '${entry.moduleId}', contributions: ${adminBindingOf(index)} },`,
    )
    .join('\n');

  return `${HEADER('generate-composer.ts')}//
// The admin contribution registry — every module package's \`./admin\` layer,
// named by the bare specifier its own \`exports\` map declares (feature 091,
// \`contracts/admin-registry.md\`).
//
// It exists because \`admin/src/App.tsx\` and \`admin/src/components/AppShell.tsx\`
// were the last two registries a module author had to hand-edit. Measured over
// the twelve most recently added modules, 11 of 12 edited each of them, while
// every backend registration point they also used to edit — the composition,
// the two \`db/\` registries, the manifest index, the permission inventory — had
// already been converted to a generator or a derivation. This is that remedy,
// applied to the two that were left.
//
// **Enumerable without being executed.** Every route and zone component in a
// contribution is a \`() => import('…')\` factory, so importing this file costs
// the declarations and none of the screens: Vite splits one chunk per module
// and an operator downloads only what their role can reach.
//
// **The registry answers "what could be here", never "what is here now".**
// Presence and permission are applied at render by \`isSurfaceVisible\`, the one
// predicate the sidebar, the palette and the dashboard already share — an
// operator's activation flip must take effect without a rebuild (Principle XVII
// item 5), and a registry that filtered would make it a restart.
//
// **Bare core under every value of \`DEPLOYMENT\`** (D-104), like the manifest
// index: a deployment's overlay modules are discovered at runtime and
// contribute to no committed artefact.

import type { AdminContributions } from '@endora-commerce/admin-kit/contributions';

${imports}

/** One module's contribution set, keyed by the module id that shipped it. */
export interface AdminRegistryEntry {
  readonly moduleId: string;
  readonly contributions: AdminContributions;
}

export const MODULE_ADMIN_CONTRIBUTIONS: readonly AdminRegistryEntry[] = [
${body}
];
`;
}

/**
 * Where the registry lands: the source root of the workspace member declaring
 * the `"@/*"` alias.
 *
 * Derived rather than spelled, for the reason `lib/admin-surfaces.ts` gives at
 * length: that alias is what `tsc` and Vite both resolve the admin's own
 * imports through, so it is a live declaration, and zero or two members
 * declaring it is a refusal rather than a walk narrowed to whichever sorted
 * first.
 */
function adminRegistryOutputPath(root: string = repoRoot): string {
  const members = workspaceMembers(root, nodeWorkspaceFs());
  const { member, target } = findAliasMember(members);
  return join(resolve(member.dir, target), ADMIN_REGISTRY_ARTEFACT);
}

/**
 * Pure render — the target path + expected content of the admin registry.
 *
 * The population is a parameter and the tree it lands in comes with it
 * (`contracts/instance-repository.md` R3.5): workspace members and this
 * repository's `admin/` by default, an instance's installed packages and its
 * own admin project when a client's generator calls it.
 */
export function renderAdminRegistry(
  population: ArtefactPopulation = workspacePopulation(),
): { outputPath: string; content: string } {
  return {
    outputPath: adminRegistryOutputPath(population.root),
    content: emitAdminRegistry(collectAdminContributions(population.packages)),
  };
}

// ── the admin stylesheet composition (artefact eight) ───────────────────────
//
// `specs/110-instance-repository/contracts/admin-stylesheet-composition.md` R2,
// FR-023. `admin/src/index.css` used to reach every package's UI with one
// `@source "../../packages/**"`. In this repository that is correct; in a
// client's instance it names a directory that is not there, because under D-207
// the shell and the module packages are **installed**. Tailwind emits no
// diagnostic for a source matching nothing (§1, M12), so the instance's admin
// would build green and render **every** screen unstyled — after T120 the shell
// is a package too.
//
// The repair inverts the direction: a package declares its own `@source` lines
// at `./tailwind.css` (R1, rendered by `manifests:generate`) and the host
// imports them by name. Every way of getting *that* wrong is loud — an
// undeclared subpath is `ERR_PACKAGE_PATH_NOT_EXPORTED` (M9), a missing package
// is `Can't resolve` (M10) — which is the property the mechanism was chosen
// for.
//
// It is rendered here rather than written by hand for R2.5's reason, which is
// `plan.md` R7.6: a shape we cannot adopt ourselves is one we may not ask a
// client for, and our own admin build is then the instance's mechanism on every
// pipeline — the only continuous evidence that it works.

/** One package whose `./tailwind.css` the host imports. */
export interface TailwindSourceEntry {
  /** The npm name, which is also the sort key (R2.1). */
  readonly name: string;
  /** The specifier the artefact writes — `<name>/tailwind.css`. */
  readonly specifier: string;
}

/** Every dependency name one manifest declares, or `[]` when it is not there. */
function declaredDependencyNames(manifestPath: string): readonly string[] {
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const declared = manifest['dependencies'];
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) return [];
  return Object.keys(declared as Record<string, unknown>);
}

/**
 * The packages this tree composes, resolved to their directories.
 *
 * **A declared dependency is the population**, and it is the one derivation
 * that answers identically in both trees: a bare specifier resolves only
 * through a declared dependency, so a package nothing declares is a package
 * whose stylesheet could not be imported anyway (M10). Nothing keys on a scope,
 * a `mod-` prefix or a directory (D-100).
 *
 * **Two manifests, unioned, because the two trees put the declaration in
 * different places and both are correct.** Here `manifests:generate` reconciles
 * every contributing module into `admin/package.json`, so the admin's own
 * manifest is the complete answer. An instance is scaffolded as a workspace
 * whose *root* holds the module dependencies and whose admin project is a
 * member of it — pnpm links a root dependency into the root `node_modules`,
 * where the admin's own resolution reaches it. Reading only the admin's
 * manifest there would render an artefact naming nothing, which is the silence
 * this whole contract exists to remove.
 */
function composedPackageDirectories(root: string): ReadonlyMap<string, string> {
  const members = workspaceMembers(root, nodeWorkspaceFs());
  const { member } = findAliasMember(members);
  const names = [
    ...declaredDependencyNames(join(member.dir, 'package.json')),
    ...declaredDependencyNames(join(root, 'package.json')),
  ];
  const byName = new Map(members.map((entry) => [entry.name, entry.dir]));
  const found = new Map<string, string>();
  for (const name of names) {
    // A workspace member first, then the installed copy. The order is the one
    // `check:module-boundary` and `overlay:check` already take: a member's own
    // directory is the declaration this repository can change, and following
    // the link instead would answer from whichever checkout `node_modules` was
    // wired to (issue #255).
    const memberDir = byName.get(name);
    const dir = memberDir ?? join(root, 'node_modules', name);
    if (!existsSync(join(dir, 'package.json'))) continue;
    found.set(name, dir);
  }
  return found;
}

/** Does the package at `dir` declare `./tailwind.css`? R2.1's predicate, off the map. */
function declaresTailwindSubpath(dir: string): boolean {
  const text = readFileSync(join(dir, 'package.json'), 'utf8');
  let manifest: { exports?: Record<string, unknown> };
  try {
    manifest = JSON.parse(text) as { exports?: Record<string, unknown> };
  } catch {
    return false;
  }
  return manifest.exports?.[TAILWIND_SOURCE_SUBPATH] !== undefined;
}

/**
 * Every package the host imports a source declaration from, sorted by name.
 *
 * **The population is FR-005's widened by one predicate** (R2.2): the admin
 * contribution registry's is *"declares `./admin`"*, this one's is *"declares
 * `./tailwind.css`"* — a superset, because it also holds the shell and the kit
 * family, which contribute UI and contribute no registry entry.
 *
 * That superset relation is asserted rather than assumed: a package the registry
 * imports and this does not is a **refusal**. It is the one state in which the
 * whole mechanism fails silently in the direction it exists to prevent — the
 * screen is registered, the bundle builds, and every class only that module
 * declares is dropped. `manifests:generate` renders both halves from one layer
 * inventory, so this state means the two artefacts were committed apart.
 */
export function collectTailwindSources(
  population: ArtefactPopulation = workspacePopulation(),
): readonly TailwindSourceEntry[] {
  const composed = composedPackageDirectories(population.root);
  const declaring = new Set<string>();
  for (const [name, dir] of composed) {
    if (declaresTailwindSubpath(dir)) declaring.add(name);
  }
  for (const entry of collectAdminContributions(population.packages)) {
    const name = packageNameOf(entry.specifier);
    if (declaring.has(name)) continue;
    throw new ModulePackageError(
      `[composer] ${name} contributes an admin layer and declares no ` +
        `'${TAILWIND_SOURCE_SUBPATH}'. The generated stylesheet imports one per package, so ` +
        `this module's screens would build and render with none of the utility classes only ` +
        `it declares — silently, because Tailwind reports nothing about a source it never ` +
        `had. Run \`pnpm --filter backend run manifests:generate\`: the subpath is rendered ` +
        `from the same layer inventory as './admin'.`,
    );
  }
  return [...declaring]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((name) => ({ name, specifier: `${name}/tailwind.css` }));
}

/** `@endora-commerce/mod-blog/tailwind.css` → `@endora-commerce/mod-blog`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
}

/** Pure render of the generated stylesheet, exported so a test can drive it. */
export function emitTailwindRegistry(entries: readonly TailwindSourceEntry[]): string {
  const imports = entries.map((entry) => `@import "${entry.specifier}";`).join('\n');
  return `/* AUTO-GENERATED by scripts/generate-composer.ts — DO NOT EDIT.
 * Run \`pnpm --filter backend run composer:generate\` to refresh. Editing this
 * file by hand is undone by the next build, and
 * \`pnpm --filter backend run overlay:check\` fails on the drift.
 *
 * The admin stylesheet composition — one import per package that declares
 * \`./tailwind.css\`, which is where that package's own \`@source\` directives
 * live (\`specs/110-instance-repository/contracts/admin-stylesheet-composition.md\`
 * R2.1).
 *
 * It replaces \`@source "../../packages/**"\`, which was correct here and named a
 * directory that does not exist in a client's instance — where the shell and
 * every module are installed under \`node_modules\`. Tailwind says nothing about a
 * source that matches nothing (M12), so that instance's admin built green and
 * rendered unstyled. Here every failure is a build error instead: a package that
 * is not installed is \`Can't resolve\`, and one whose tarball omits the file is
 * \`ERR_PACKAGE_PATH_NOT_EXPORTED\`.
 *
 * An \`@source\` **adds** to Tailwind's automatic detection rather than replacing
 * it, and that detection is rooted at this Vite project — so the admin's own
 * sources need no directive here (R2.3).
 */
${imports}
`;
}

/** Where the generated stylesheet lands: beside the admin contribution registry. */
function tailwindRegistryOutputPath(root: string = repoRoot): string {
  const members = workspaceMembers(root, nodeWorkspaceFs());
  const { member, target } = findAliasMember(members);
  return join(resolve(member.dir, target), TAILWIND_REGISTRY_ARTEFACT);
}

/** Pure render — the target path + expected content of the generated stylesheet. */
export function renderTailwindRegistry(
  population: ArtefactPopulation = workspacePopulation(),
): { outputPath: string; content: string } {
  return {
    outputPath: tailwindRegistryOutputPath(population.root),
    content: emitTailwindRegistry(collectTailwindSources(population)),
  };
}

// ── the documentation registry ──────────────────────────────────────────────
//
// Artefacts six and seven (feature 100 / roadmap F12, `contracts/docs-registry.md`
// §1). They join this generator rather than getting one of their own for the
// reason the admin registry did: the population is the generated manifest index,
// which this generator already walks, and two derivations of one population are
// two answers waiting to disagree — which is exactly the state they replace.
// Three hand-maintained lists described the modules this platform composes, and
// all three disagreed with the index and with each other: 8 written pages were
// reachable from no navigation and 23 registered modules had no map row.
//
// **Only the navigation is generated.** 10,311 lines of hand-written prose stay
// hand-written and stay where they are; nothing here writes a page.

/** The label the module map's first column uses when a page carries none. */
const MAP_FALLBACK_LABEL = (moduleId: string): string => moduleId;

/** One module's row and navigation entry, as the two artefacts need it. */
interface DocsRegistryEntry {
  readonly moduleId: string;
  readonly docs: ModuleDocs | null;
  /** `@endora-commerce/mod-<id>` for a packaged module, `core` for a host-owned one. */
  readonly shipsFrom: string;
  /**
   * The doc id of the module's generated reference page, or `null` when the
   * module declares `docs: false` and therefore owes none (Phase 3).
   *
   * It is carried here because the **navigation** is where a reference page is
   * reached from: the pages sit in their own category, and a reader should
   * never have to know that. A module with prose gets it as a child of its own
   * entry; a module with none gets it as an entry, which is what keeps a
   * generated page from being reachable by guessing a URL — the defect this
   * whole feature exists to end, arriving through its own new artefact.
   */
  readonly referenceDocId: string | null;
}

/**
 * Every registered module, with the documentation the site holds for it.
 *
 * The population is the **index's**, so a module with no page is an entry with
 * no documentation rather than an absence — the module map is a census of the
 * platform, not a census of what somebody happened to write.
 */
export function collectDocsRegistry(
  registered: readonly string[],
  attribution: DocsAttribution,
  packages: readonly ModulePackage[],
  /** Modules that declare `docs: false` — they owe no page, generated or written. */
  declinedDocs: ReadonlySet<string> = new Set(),
): readonly DocsRegistryEntry[] {
  const byModule = new Map(attribution.documented.map((entry) => [entry.moduleId, entry]));
  const packageName = new Map(packages.map((pkg) => [pkg.moduleId, pkg.name]));
  return [...registered]
    .sort((a, b) => a.localeCompare(b))
    .map((moduleId) => ({
      moduleId,
      docs: byModule.get(moduleId) ?? null,
      shipsFrom: packageName.get(moduleId) ?? 'core',
      referenceDocId: declinedDocs.has(moduleId)
        ? null
        : `${MODULE_REFERENCE_CATEGORY}/${slugForModule(moduleId)}`,
    }));
}

/** A JS string literal for the emitted CommonJS fragment. */
function jsString(value: string): string {
  return `'${value.split('\\').join('\\\\').split("'").join("\\'")}'`;
}

/**
 * The sidebar's Modules category, as the array Docusaurus already accepts.
 *
 * `.js` rather than `.ts` because `sidebars.js` is `.js`, `sidebarPath` is
 * `require`d by Docusaurus, and `docs/tsconfig.json` extends
 * `@docusaurus/tsconfig`, which sets no `allowJs` — so a `.ts` fragment would be
 * read by the site and by no type-checker, which is worse than either.
 *
 * Ordering is **flat and alphabetical by label**, with a page's own
 * `sidebar_position` overriding (research D-5). Today's hand-written list
 * clusters the payment and delivery vendors out of alphabetical order, and that
 * clustering is not derivable — `tpay` does not declare `payments` in its
 * manifest dependencies at all — so the flat list is taken and the loss is
 * stated rather than papered over with a front-matter field this repository
 * would have invented. `spec.md` Q1 is the owner's question about it.
 */
export function emitDocsSidebar(entries: readonly DocsRegistryEntry[]): string {
  const items = entries
    // A module with neither prose nor a reference page contributes nothing: it
    // declared `docs: false`, and an entry for it would be a navigation line
    // naming a page that is deliberately not there.
    .filter((entry) => entry.docs !== null || entry.referenceDocId !== null)
    .map((entry) => ({
      label:
        entry.docs === null
          ? MAP_FALLBACK_LABEL(entry.moduleId)
          : labelOf(entry.docs.entry, MAP_FALLBACK_LABEL(entry.moduleId)),
      position: entry.docs === null ? null : categoryPositionOf(entry.docs.entry),
      entry,
    }))
    .sort(comparePages)
    .map(({ label, entry }) => {
      const { docs, referenceDocId } = entry;
      // A module nobody has written about yet still has a reference page, and
      // this is where a reader reaches it. Without the entry the page would be
      // findable only by guessing a URL — `spec.md` § 0.2's defect, arriving
      // through the artefact meant to answer it.
      if (docs === null) {
        return `  { type: 'doc', id: ${jsString(referenceDocId ?? '')}, label: ${jsString(
          label,
        )} },`;
      }
      const items = [
        ...docs.children.map((child) => child.docId),
        ...(referenceDocId === null ? [] : [referenceDocId]),
      ];
      if (items.length === 0) {
        return `  { type: 'doc', id: ${jsString(docs.entry.docId)}, label: ${jsString(label)} },`;
      }
      // The reference page goes **last**, after whatever sub-pages a module
      // wrote: a generated table is what a reader falls back to, not what they
      // are shown first.
      const children = items.map((docId) => `      ${jsString(docId)},`).join('\n');
      return (
        `  {\n` +
        `    type: 'category',\n` +
        `    label: ${jsString(label)},\n` +
        `    link: { type: 'doc', id: ${jsString(docs.entry.docId)} },\n` +
        `    items: [\n${children}\n    ],\n` +
        `  },`
      );
    })
    .join('\n');

  // The generated map is navigation for a generated page, so it belongs in the
  // generated fragment: putting it in `sidebars.js` would make the category's
  // item list a hand-edited file again, one entry short of the thing this
  // artefact exists to remove.
  const map = `  { type: 'doc', id: ${jsString(
    `${MODULES_CATEGORY}/${MODULE_MAP_ARTEFACT.replace(/\.mdx?$/, '')}`,
  )}, label: 'Module map' },`;

  return `${HEADER('generate-composer.ts')}//
// The Modules category of the documentation sidebar (feature 100 / roadmap F12,
// \`contracts/docs-registry.md\` §1). \`sidebars.js\` requires it:
//
//     items: require('./sidebars.modules.generated.js'),
//
// Every entry is derived — the module set from the generated manifest index, the
// page from the site's own tree, the label from the page's own Docusaurus front
// matter (\`sidebar_label\`, else \`title\`), the order from \`sidebar_position\` and
// then alphabetically by label. No field this repository invented appears here or
// in any page, so a third-party module author writes ordinary Docusaurus
// markdown and learns nothing from us.
//
// It exists because the hand-written list this replaces was edited by 12 of the
// 12 most recently added modules and forgotten by seven of them: \`ksef\`,
// \`newsletter\`, \`pwa\`, \`returns\`, \`shipments\`, \`transactional_emails\` and
// \`google_analytics\` each had a written page a reader could only reach by
// guessing a URL, and nothing in the repository could see it.

/** @type {import('@docusaurus/plugin-content-docs').SidebarItemConfig[]} */
const modules = [
${map}
${items}
];

module.exports = modules;
`;
}

/** Escape a cell so a capability sentence carrying a pipe cannot break the table. */
function markdownCell(value: string): string {
  return value.split('|').join('\\|').split('\n').join(' ').trim();
}

/**
 * The module map — one row per **registered** module, never per page.
 *
 * A module the index registers and no page documents gets a row saying so,
 * rather than being silently absent: the map is a census of the platform, and an
 * absence is the defect this feature exists to end. 23 registered modules had no
 * row when this landed.
 *
 * The old table's third column, `Owns HTTP surface?`, is **dropped**. It was
 * hand-written, wrong in several rows, and is not cheaply derivable — a module's
 * routes are registered through `ctx.routes` at composition and declared in no
 * manifest. A column that cannot be derived is a column that goes stale, which
 * is the defect this artefact replaces.
 */
export function emitModuleMap(entries: readonly DocsRegistryEntry[]): string {
  const rows = entries
    .map((entry) => {
      if (entry.docs === null) {
        return (
          `| \`${entry.moduleId}\` | _no page yet_ | ${markdownCell(entry.shipsFrom)} |`
        );
      }
      const label = labelOf(entry.docs.entry, MAP_FALLBACK_LABEL(entry.moduleId));
      const href = `./${entry.docs.entry.relativePath}`;
      const capability = entry.docs.entry.frontMatter.description ?? '_no description yet_';
      return `| [${markdownCell(label)}](${href}) | ${markdownCell(capability)} | ${markdownCell(entry.shipsFrom)} |`;
    })
    .join('\n');

  return `<!-- AUTO-GENERATED by scripts/generate-composer.ts — DO NOT EDIT.
     Run \`pnpm --filter backend run composer:generate\` to refresh. Editing this
     file by hand is undone by the next run, and
     \`pnpm --filter backend run overlay:check\` fails on the drift. -->
---
title: Module map
sidebar_label: Module map
description: Every module this platform composes, with the capability it owns and the package that ships it.
---

# Module map

One row per module the platform registers — derived from the generated manifest
index, the pages on disk and each page's own \`description\` front matter. A
module with no page is listed with none rather than left out: this is a census
of the platform, not of what happens to be written.

| Module | Capability | Ships from |
| --- | --- | --- |
${rows}
`;
}

// ── the generated reference page, one per module ────────────────────────────
//
// Artefacts eight and onward (feature 100 Phase 3, `contracts/docs-registry.md`;
// FR-022 and FR-024). Everything on one of these pages is in the module's own
// manifest already — its permissions and their labels, its palette actions, the
// settings it owns, whether an operator may switch it off and what the control
// defaults to, what it depends on and what ships it — and none of it was
// documented anywhere a reader could find. What each module author did instead
// was write the same table by hand, or not write it at all: `spec.md` § 0.3's
// fifty stale sentences are what that produces.
//
// Two properties decide whether this is worth having, and they are the two the
// feature is about. It is rendered **from the manifest and nothing else**, so
// there is no second source to keep in step; and it is a committed artefact of
// this generator, so a manifest that changes and a page that does not is
// `overlay:check`'s `stale` rather than a divergence nobody sees.
//
// FR-024 is why it is a page of its own rather than a block spliced into the
// module's prose: `overlay:check` renders a whole artefact twice and compares,
// which a half-generated file cannot be held to.

/** One module's reference page, as the manifest answers for it. */
export interface ModuleReference {
  readonly moduleId: string;
  /** The page's slug and doc id tail — {@link slugForModule}. */
  readonly slug: string;
  readonly name: string;
  readonly version: string;
  /** `@endora-commerce/mod-<id>` for a packaged module, `core` for a host-owned one. */
  readonly shipsFrom: string;
  readonly license: string | null;
  readonly activation:
    | { readonly kind: 'control'; readonly settingCode: string; readonly default: boolean }
    | { readonly kind: 'locked'; readonly reason: string }
    | null;
  readonly dependencies: readonly string[];
  readonly acknowledgedDependencies: readonly {
    readonly moduleId: string;
    readonly port: string;
    readonly reason: string;
  }[];
  readonly nonBindingDependencies: readonly {
    readonly moduleId: string;
    readonly name: string;
    readonly kind: string;
    readonly whenAbsent: string | null;
  }[];
  readonly permissions: readonly {
    readonly code: string;
    readonly label: string;
    readonly requires: readonly string[];
  }[];
  readonly actions: readonly {
    readonly id: string;
    readonly targetRoute: string;
    readonly requiredPermission: string | null;
  }[];
  readonly settings: readonly {
    readonly code: string;
    readonly name: string;
    readonly valueType: string;
  }[];
  readonly bundlesDir: string | null;
  readonly cliCommands: readonly { readonly name: string; readonly summary: string }[];
  /**
   * The module's own prose page, relative to this one, or `null` when nobody
   * has written it yet.
   *
   * A **link and not a doc id**: Docusaurus resolves a link naming the `.md`
   * file to that file's permalink, whatever the permalink turns out to be,
   * which is the spelling that cannot go wrong under `onBrokenLinks: 'throw'`
   * (`DocPage.relativePath`'s note, one artefact over).
   */
  readonly prosePage: string | null;
}

/** Raised when a page in the reference category belongs to no module. */
export class StrayReferencePageError extends ModulePackageError {}

/** What one manifest module exports, as much of it as a reference page reads. */
interface LoadedManifestModule {
  readonly manifest?: Record<string, unknown>;
  readonly cliCommands?: readonly { name?: unknown; summary?: unknown }[];
}

/** A manifest field, read defensively — the generator must not trust a shape. */
function arrayOf(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * One module's reference record, from its manifest and the package that ships it.
 *
 * The manifest is **imported**, not parsed out of its source text, for the
 * reason `renderComposer` already imports one: a manifest is TypeScript with
 * arrays, spreads and helper calls in it, and a text scan of that is a second
 * reader of a declaration whose first reader is the platform. What is imported
 * is the module's own `manifest.ts` — never the generated index, which is this
 * generator's own previous answer.
 */
export function referenceOf(
  moduleId: string,
  loaded: LoadedManifestModule,
  shipsFrom: string,
  prosePage: string | null,
): ModuleReference {
  const manifest = loaded.manifest ?? {};
  const activationRaw = manifest.activation as Record<string, unknown> | undefined;
  const activation: ModuleReference['activation'] =
    activationRaw === undefined
      ? null
      : activationRaw.nonDeactivatable === true
        ? { kind: 'locked', reason: stringOr(activationRaw.reason, 'not stated') }
        : {
            kind: 'control',
            settingCode: stringOr(activationRaw.settingCode, '(unnamed)'),
            default: activationRaw.default === true,
          };
  const settings = manifest.settings as Record<string, unknown> | undefined;
  const i18n = manifest.i18n as Record<string, unknown> | undefined;
  return {
    moduleId,
    slug: slugForModule(moduleId),
    name: stringOr(manifest.name, moduleId),
    version: stringOr(manifest.version, '0.0.0'),
    shipsFrom,
    license: stringOrNull(manifest.license),
    activation,
    dependencies: [...arrayOf(manifest.dependencies).map(String)].sort(),
    acknowledgedDependencies: arrayOf(manifest.acknowledgedDependencies)
      .map((entry) => ({
        moduleId: stringOr(entry.moduleId, '?'),
        port: stringOr(entry.port, '?'),
        reason: stringOr(entry.reason, ''),
      }))
      .sort((a, b) => `${a.moduleId}${a.port}`.localeCompare(`${b.moduleId}${b.port}`)),
    nonBindingDependencies: arrayOf(manifest.nonBindingDependencies)
      .map((entry) => ({
        moduleId: stringOr(entry.moduleId, '?'),
        name: stringOr(entry.name, '?'),
        kind: stringOr(entry.kind, '?'),
        whenAbsent: stringOrNull(entry.whenAbsent),
      }))
      .sort((a, b) => `${a.moduleId}${a.name}`.localeCompare(`${b.moduleId}${b.name}`)),
    permissions: arrayOf(manifest.permissions)
      .map((entry) => ({
        code: stringOr(entry.code, '?'),
        label: stringOr(entry.label, ''),
        requires: Array.isArray(entry.requires) ? entry.requires.map(String) : [],
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    actions: arrayOf(manifest.actions)
      .map((entry) => ({
        id: stringOr(entry.id, '?'),
        targetRoute: stringOr(entry.targetRoute, '?'),
        requiredPermission: stringOrNull(entry.requiredPermission),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    settings: arrayOf(settings?.settings)
      .map((entry) => ({
        code: stringOr(entry.code, '?'),
        name: stringOr(entry.name, ''),
        valueType: stringOr(entry.valueType, '?'),
      }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    bundlesDir: i18n === undefined ? null : stringOr(i18n.bundlesDir, 'i18n'),
    cliCommands: (loaded.cliCommands ?? [])
      .map((entry) => ({
        name: stringOr(entry.name, '?'),
        summary: stringOr(entry.summary, ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    prosePage,
  };
}

/** A markdown table, or the sentence that says there is nothing in it. */
function table(headings: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return '_None._\n';
  return (
    `| ${headings.join(' | ')} |\n` +
    `| ${headings.map(() => '---').join(' | ')} |\n` +
    rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`).join('\n') +
    '\n'
  );
}

/** A value the reader is meant to copy, or an em dash where there is none. */
function code(value: string | null): string {
  return value === null || value === '' ? '—' : `\`${value}\``;
}

/**
 * One module's reference page.
 *
 * Pure over the record, so a test drives every section on input this repository
 * does not contain. Every list is sorted by the collector rather than by the
 * walk that produced it, because `overlay:check` renders twice and compares:
 * an ordering that came off a filesystem read would make the artefact
 * non-deterministic in a way that only shows up on somebody else's machine.
 */
export function emitModuleReference(reference: ModuleReference): string {
  const activation =
    reference.activation === null
      ? 'This module declares no activation control, so an operator cannot switch it off ' +
        'from the Admin UI. Its presence is the platform-availability axis alone — the ' +
        'lifecycle registry, changed by deployment tooling.\n'
      : reference.activation.kind === 'locked'
        ? `**This module cannot be switched off.** ${reference.activation.reason}\n`
        : `An operator switches this module on and off on **/platform/modules**. The choice ` +
          `is the setting ${code(reference.activation.settingCode)}, and it defaults to ` +
          `**${reference.activation.default ? 'on' : 'off'}**.\n`;

  const dependencies = table(
    ['Module', 'Binding', 'What it means'],
    [
      ...reference.dependencies.map((id) => [
        `\`${id}\``,
        'yes',
        'installs and migrates after it, and an operator cannot switch it off underneath ' +
          'this module',
      ]),
      ...reference.acknowledgedDependencies.map((entry) => [
        `\`${entry.moduleId}\``,
        'gating only',
        `resolves \`${entry.port}\`; withheld from \`dependencies\` because the install ` +
          'order cannot carry the edge',
      ]),
      ...reference.nonBindingDependencies.map((entry) => [
        `\`${entry.moduleId}\``,
        'no',
        `${entry.kind} \`${entry.name}\`` +
          (entry.whenAbsent === null ? '' : ` — ${entry.whenAbsent}`),
      ]),
    ],
  );

  const summary =
    `Everything the \`${reference.moduleId}\` module's manifest declares: permissions, ` +
    'palette actions, settings, activation and dependencies.';

  return (
    `<!-- AUTO-GENERATED by scripts/generate-composer.ts — DO NOT EDIT.\n` +
    `     Run \`pnpm --filter backend run composer:generate\` to refresh. Editing this\n` +
    `     file by hand is undone by the next run, and\n` +
    `     \`pnpm --filter backend run overlay:check\` fails on the drift. -->\n` +
    `---\n` +
    `title: ${reference.moduleId} — module reference\n` +
    `sidebar_label: Reference\n` +
    `description: ${summary}\n` +
    `---\n\n` +
    `# \`${reference.moduleId}\` — module reference\n\n` +
    `Rendered from the module's own manifest, and from nothing written by hand. ` +
    (reference.prosePage === null
      ? `Nobody has written a page about what this module *does* yet; the ` +
        `[module map](../${MODULES_CATEGORY}/${MODULE_MAP_ARTEFACT}) lists every module ` +
        `the platform composes.\n\n`
      : `What the module *does* is [its own page](${reference.prosePage}).\n\n`) +
    `| | |\n| --- | --- |\n` +
    `| Module id | ${code(reference.moduleId)} |\n` +
    `| Name | ${markdownCell(reference.name)} |\n` +
    `| Version | ${code(reference.version)} |\n` +
    `| Ships from | ${code(reference.shipsFrom)} |\n` +
    `| Licence tier | ${code(reference.license)} |\n\n` +
    `## Activation\n\n${activation}\n` +
    `## Dependencies\n\n${dependencies}\n` +
    `## Permissions\n\n` +
    table(
      ['Code', 'Label', 'Also needs'],
      reference.permissions.map((entry) => [
        `\`${entry.code}\``,
        entry.label,
        entry.requires.length === 0 ? '—' : entry.requires.map((c) => `\`${c}\``).join(', '),
      ]),
    ) +
    `\n## Command palette\n\n` +
    table(
      ['Action', 'Opens', 'Permission'],
      reference.actions.map((entry) => [
        `\`${entry.id}\``,
        `\`${entry.targetRoute}\``,
        code(entry.requiredPermission),
      ]),
    ) +
    `\n## Settings\n\n` +
    table(
      ['Code', 'Name', 'Type'],
      reference.settings.map((entry) => [`\`${entry.code}\``, entry.name, `\`${entry.valueType}\``]),
    ) +
    `\n## Translations\n\n` +
    (reference.bundlesDir === null
      ? 'This module declares no translation bundles.\n'
      : `Bundles at ${code(reference.bundlesDir)} inside the module, one file per shipped ` +
        'language.\n') +
    `\n## Operator commands\n\n` +
    table(
      ['Command', 'What it does'],
      reference.cliCommands.map((entry) => [
        `\`pnpm --filter backend run cli -- ${reference.moduleId} ${entry.name}\``,
        entry.summary,
      ]),
    )
  );
}

/**
 * A module's documentation layer, from its manifest's own source text.
 *
 * A **computed** `dir` throws rather than reading as "declares nothing" (issue
 * #113): a directory this walk cannot place is a module whose pages would
 * simply not be collected, with no error anywhere.
 */
function docsRootOf(id: string, source: string, moduleRoot: string): string | null {
  const declaration = docsDeclarationIn(source);
  if (declaration === undefined || declaration === false) return null;
  if (declaration === 'unreadable') {
    throw new ModulePackageError(
      `[composer] ${id}'s manifest declares \`docs\` with no literal \`dir\`. The directory is ` +
        'the anchor the platform joins to the module\'s own root, so a value this generator ' +
        'cannot read is a documentation layer nothing collects and nothing reports.',
    );
  }
  return join(moduleRoot, declaration.dir);
}

/**
 * Every page the platform can see, the site's own tree and the modules' alike.
 *
 * A **mixed** tree is the supported state and not a transitional accident: a
 * page in the site tree and a page in a module package are attributed by the
 * same derivation, which is what lets Phase 2 land one batch at a time
 * (`plan.md` § Phasing). `_lifecycle` is the standing resident of the site half
 * — its manifest resolves inside the platform package's **build output**, and
 * documentation is not a compiled asset, so it has no package root to ship
 * from.
 *
 * A declared directory that is **not on disk** is a refusal naming the module
 * (FR-017), and two sources claiming one doc id is a refusal too: the copy
 * would write one over the other and whichever ran second would win, making the
 * site's content depend on a directory read order.
 */
function collectAllDocPages(layout: DocsLayout, manifests: readonly DiscoveredManifest[]): DocPage[] {
  const sources: ModuleDocsSource[] = [];
  const missing: string[] = [];
  for (const manifest of manifests) {
    if (manifest.docsRoot === null) continue;
    if (!isDirectory(manifest.docsRoot)) {
      missing.push(`${manifest.id} -> ${manifest.docsRoot}`);
      continue;
    }
    sources.push({ moduleId: manifest.id, root: manifest.docsRoot });
  }
  if (missing.length > 0) {
    throw new ModulePackageError(
      `[composer] ${missing.length} module(s) declare a documentation directory that is not ` +
        `on disk:\n${missing.map((entry) => `  - ${entry}`).join('\n')}\n` +
        'A declared directory that is absent is a refusal and never "this module ships no ' +
        'documentation" — declare `docs: false` if that is the decision, or ship the directory.',
    );
  }
  const modulePages = collectModuleDocPages(sources);
  const copies = new Set(modulePages.map((page) => copyTargetOf(page, layout.modulesRoot)));
  const pages = [...collectDocPages(layout.modulesRoot, copies), ...modulePages];
  const duplicates = duplicateDocIds(pages);
  if (duplicates.length > 0) {
    throw new ModulePackageError(
      `[composer] ${duplicates.length} documentation page(s) are claimed twice:\n` +
        duplicates
          .map((entry) => `  - ${entry.docId}\n      ${entry.paths.join('\n      ')}`)
          .join('\n'),
    );
  }
  return pages.sort((a, b) => a.docId.localeCompare(b.docId));
}

/** One read of the site's tree, the modules' layers and the index. */
function docsRegistry(population: ArtefactPopulation): {
  layout: DocsLayout;
  pages: readonly DocPage[];
  entries: readonly DocsRegistryEntry[];
  /** What the index walk found, so the reference renderer needs no second one. */
  manifests: readonly DiscoveredManifest[];
  attribution: DocsAttribution;
  /** Copy target -> module source, for `overlay:check`'s containment verdict. */
  entrySources: ReadonlyMap<string, string>;
} {
  const layout = resolveDocsLayout(population.root);
  const manifests = discoverManifests(population.packages, population.application);
  const ids = manifests.map((manifest) => manifest.id);
  const pages = collectAllDocPages(layout, manifests);
  const attribution = attributeDocs(pages, ids);
  const declinedDocs = new Set(
    manifests.filter((manifest) => manifest.declaresNoDocs).map((manifest) => manifest.id),
  );
  return {
    layout,
    pages,
    manifests,
    attribution,
    entries: collectDocsRegistry(ids, attribution, population.packages, declinedDocs),
    entrySources: new Map(
      pages
        .filter((page) => page.origin.kind === 'module')
        .map((page) => [copyTargetOf(page, layout.modulesRoot), page.path] as const),
    ),
  };
}

/**
 * Where each module's generated reference page lands, by module id.
 *
 * Synchronous, because {@link generatedArtifactPaths} is: *which* pages exist
 * is a question about the manifests' `docs` declarations, which the index walk
 * reads out of their source text, and only their **content** needs the import.
 *
 * Two modules folding onto one slug is a refusal rather than a page written
 * twice — `slugForModule` strips a leading underscore, so a hypothetical
 * `i18n` beside `_i18n` would have one of the two silently overwrite the other,
 * and which one would depend on the order the index walk happened to produce.
 */
export function referencePagePaths(
  layout: DocsLayout,
  manifests: readonly DiscoveredManifest[],
): ReadonlyMap<string, string> {
  const paths = new Map<string, string>();
  const bySlug = new Map<string, string>();
  for (const manifest of manifests) {
    if (manifest.declaresNoDocs) continue;
    const slug = slugForModule(manifest.id);
    const clash = bySlug.get(slug);
    if (clash !== undefined) {
      throw new ModulePackageError(
        `[composer] '${clash}' and '${manifest.id}' both document at the reference slug ` +
          `'${slug}'. One page would be written over the other and which one survived would ` +
          'depend on the order the manifest walk produced.',
      );
    }
    bySlug.set(slug, manifest.id);
    paths.set(manifest.id, join(layout.contentRoot, MODULE_REFERENCE_CATEGORY, `${slug}.md`));
  }
  return paths;
}

/**
 * Every module's reference page — one committed artefact each (FR-022/FR-024).
 *
 * The manifests are **imported** here and read as source text everywhere else in
 * this generator, which is the estate's independent-author pattern rather than
 * an inconsistency: what a page renders is the manifest's *values* —
 * permission labels, an activation default, a palette route — and a text scan of
 * a TypeScript object literal is a second reader of a declaration whose first
 * reader is the platform.
 *
 * A page in the category that no module claims is a **refusal**. It is the
 * `orphan-page` state one category over: a module that was removed leaves a
 * committed page in no navigation, reachable by URL, describing a module the
 * platform no longer composes — and unlike a page under the modules category,
 * nothing else in the estate walks this one. The remedy is `git rm`, which is
 * why this refuses rather than sweeping: a generator that deletes committed
 * files is a generator whose output a reviewer has to reconstruct.
 */
export async function renderModuleReferences(
  population: ArtefactPopulation = workspacePopulation(),
): Promise<ReadonlyArray<RenderedArtefact & { label: string }>> {
  const { layout, manifests, entries, entrySources } = docsRegistry(population);
  const paths = referencePagePaths(layout, manifests);
  const byModule = new Map(entries.map((entry) => [entry.moduleId, entry]));

  const rendered: Array<RenderedArtefact & { label: string }> = [];
  for (const manifest of manifests) {
    const outputPath = paths.get(manifest.id);
    if (outputPath === undefined) continue;
    const entry = byModule.get(manifest.id);
    const loaded = (await import(pathToFileURL(manifest.manifestPath).href)) as LoadedManifestModule;
    const reference = referenceOf(
      manifest.id,
      loaded,
      entry?.shipsFrom ?? 'core',
      entry?.docs == null ? null : `../${MODULES_CATEGORY}/${entry.docs.entry.relativePath}`,
    );
    rendered.push({
      label: `module-reference (${manifest.id})`,
      outputPath,
      content: emitModuleReference(reference),
      entryKind: 'doc-id',
      entryRoot: layout.contentRoot,
      entrySources,
    });
  }

  const expected = new Set(rendered.map((artefact) => artefact.outputPath));
  const stray = strayReferencePages(layout, expected);
  if (stray.length > 0) {
    throw new StrayReferencePageError(
      `[composer] ${stray.length} page(s) under ${MODULE_REFERENCE_CATEGORY}/ belong to no ` +
        `registered module:\n${stray.map((path) => `  - ${path}`).join('\n')}\n` +
        'Every page in that category is generated from a manifest, so one nothing renders is ' +
        'a module that has gone: `git rm` it. It is refused rather than swept because a ' +
        'committed file this generator deleted is a change no reviewer asked for.',
    );
  }
  return rendered;
}

/** Pages on disk in the reference category that this run does not write. */
export function strayReferencePages(
  layout: DocsLayout,
  expected: ReadonlySet<string>,
): readonly string[] {
  const directory = join(layout.contentRoot, MODULE_REFERENCE_CATEGORY);
  if (!isDirectory(directory)) return [];
  return readdirSync(directory)
    .filter((name) => PAGE_EXTENSIONS.some((extension) => name.endsWith(extension)))
    .map((name) => join(directory, name))
    .filter((path) => !expected.has(path))
    .sort();
}

/**
 * Pure render — the target path + expected content of the sidebar fragment.
 *
 * The path is derived from the workspace member holding the Docusaurus
 * configuration, never written down (D-100), exactly as the admin registry's is
 * derived from the member declaring the `"@/*"` alias.
 */
export function renderDocsSidebar(
  population: ArtefactPopulation = workspacePopulation(),
): RenderedArtefact {
  const { layout, entries, entrySources } = docsRegistry(population);
  return {
    outputPath: join(layout.member.dir, DOCS_SIDEBAR_ARTEFACT),
    content: emitDocsSidebar(entries),
    entryKind: 'doc-id',
    entryRoot: layout.contentRoot,
    entrySources,
  };
}

/**
 * The record of what the last collection wrote, so the next one can undo it.
 *
 * The copies are **not committed** (`.gitignore`), which is what keeps 10,311
 * lines of prose from existing twice in this repository — one editable copy and
 * one that looks editable and is not. The consequence is that nothing else
 * knows which files under the modules category are copies, and a page a module
 * deletes would otherwise be served for ever. The stamp answers exactly that
 * and nothing else: a run removes the files the previous run wrote and no
 * longer writes, and a fresh checkout with no stamp removes nothing, which is
 * correct because it has copied nothing.
 */
const COPY_STAMP = '.module-docs-copies.json';

/** What one collection did, for the caller to report. */
export interface DocsCollection {
  readonly modulesRoot: string;
  readonly copied: readonly string[];
  readonly removed: readonly string[];
}

/**
 * Copy every module-owned page into the site's tree, preserving its address.
 *
 * **Copy, never symlink** (research D-8): Docusaurus resolves `docs.path` and
 * its `include` globs against the site directory, and a symlinked subtree makes
 * the file watcher, webpack's module graph and the markdown link resolver
 * disagree about where a page is — issue #255's finding, one tool reading one
 * tree while another reads a second.
 *
 * The target is the page's own relative path inside the category, so the copy
 * preserves the doc id, the permalink and every relative link written against
 * it (`module-documentation-layer.md` R5.2). That is what makes the move
 * invisible to a reader and to an inbound link alike.
 */
export function collectDocsIntoSite(
  population: ArtefactPopulation = workspacePopulation(),
): DocsCollection {
  const { layout, pages } = docsRegistry(population);
  const stampPath = join(layout.member.dir, COPY_STAMP);
  const previous: string[] = existsSync(stampPath)
    ? (JSON.parse(readFileSync(stampPath, 'utf8')) as string[])
    : [];

  const copied: string[] = [];
  for (const page of pages) {
    if (page.origin.kind !== 'module') continue;
    const target = copyTargetOf(page, layout.modulesRoot);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(page.path, target);
    copied.push(relative(layout.member.dir, target));
  }

  const current = new Set(copied);
  const removed: string[] = [];
  for (const stale of previous) {
    if (current.has(stale)) continue;
    const target = join(layout.member.dir, stale);
    if (!existsSync(target)) continue;
    rmSync(target);
    removed.push(stale);
  }
  writeFileSync(stampPath, `${JSON.stringify([...copied].sort(), null, 2)}\n`, 'utf8');
  return { modulesRoot: layout.modulesRoot, copied: copied.sort(), removed: removed.sort() };
}

/** Pure render — the target path + expected content of the module map. */
export function renderModuleMap(
  population: ArtefactPopulation = workspacePopulation(),
): RenderedArtefact {
  const { layout, entries, entrySources } = docsRegistry(population);
  return {
    outputPath: join(layout.modulesRoot, MODULE_MAP_ARTEFACT),
    content: emitModuleMap(entries),
    entryKind: 'doc-id',
    entryRoot: layout.contentRoot,
    entrySources,
  };
}

/**
 * One rendered artefact, and how `overlay:check` reads the entries in it.
 *
 * `entryKind` exists because the two documentation artefacts name **doc ids and
 * relative page links** rather than import specifiers, and the containment
 * verdict has to be re-derived for them (`contracts/docs-registry.md` R2.3). It
 * is carried on the artefact rather than inferred from its extension so that the
 * generator that knows the answer is the one that states it — an inference off
 * `.js` would have classified the sidebar fragment as a source file, whose
 * import specifiers are none.
 */
export interface RenderedArtefact {
  readonly outputPath: string;
  readonly content: string;
  /**
   * Defaults to `'specifier'` — every artefact that came before feature 100.
   *
   * `'none'` is an artefact that names no entry **by construction**: the
   * published baseline list names migration *classes*, which are not files and
   * have no containment question. It is declared rather than omitted, because
   * `overlay:check`'s per-artefact floor otherwise reads an empty population as
   * a walk that came back short (D-155.6).
   *
   * `'css-specifier'` is the eighth artefact (feature 110, T124): a stylesheet
   * naming its entries with CSS's own `@import`. Same containment question,
   * different grammar.
   */
  readonly entryKind?: 'specifier' | 'doc-id' | 'none' | 'css-specifier';
  /** The root a bare `doc-id` entry resolves against. Absent for a specifier. */
  readonly entryRoot?: string;
  /**
   * Copy target -> the module-owned source it is copied from (feature 100
   * Phase 2).
   *
   * `overlay:check` asks *whose file is this*, and for a module-owned page the
   * answer is the module's package — not the site's tree, where the copy is not
   * committed and on a fresh checkout is not there at all.
   */
  readonly entrySources?: ReadonlyMap<string, string>;
}

/** Every committed artefact, rendered from one read of the tree. */
export async function renderAll(): Promise<
  ReadonlyArray<RenderedArtefact & { label: string }>
> {
  const population = workspacePopulation();
  const sources = readSourceTree(population.packages);
  const composer = await renderComposer();
  return [
    { label: 'composition.generated', ...composer },
    { label: 'manifest-index', ...renderManifestIndex(population.packages) },
    { label: 'entities-registry', ...renderEntitiesRegistry(sources) },
    { label: 'migrations-registry', ...renderMigrationsRegistry(sources) },
    // The published baseline list names migration **classes**, not files, so it
    // has no containment population — it is the `kind: 'none'` case D-155.6
    // added for the divergence report's markdown sibling. That the list and the
    // registry agree is R1.7, and it is asserted where it can be: over both
    // committed artefacts, in test/unit/db/instance-migration-order.test.ts.
    { label: 'baseline-migrations', ...renderBaselineList(sources), entryKind: 'none' as const },
    { label: 'admin-registry', ...renderAdminRegistry(population) },
    { label: 'admin-tailwind', ...renderTailwindRegistry(population), entryKind: 'css-specifier' as const },
    { label: 'docs-sidebar', ...renderDocsSidebar(population) },
    { label: 'module-map', ...renderModuleMap(population) },
    ...(await renderModuleReferences(population)),
  ];
}

async function main(): Promise<void> {
  const rendered = await renderAll();

  // `--check` never writes: it is the CI form, and a CI job that repairs the
  // tree it is checking reports green on a commit nobody can reproduce.
  if (process.argv.includes('--check')) {
    let stale = false;
    for (const { outputPath, content } of rendered) {
      const onDisk = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;
      if (onDisk === content) continue;
      stale = true;
      process.stderr.write(
        `[composer] ${onDisk === null ? 'missing' : 'STALE'}: ${outputPath}\n` +
          '  Regenerate and commit: pnpm --filter backend run composer:generate\n',
      );
    }
    if (stale) process.exit(1);
    process.stdout.write('[composer] committed artefacts are up to date ✓\n');
    return;
  }

  for (const { outputPath, content } of rendered) {
    // The reference category is created by this run: it holds nothing but
    // generated pages, so a fresh checkout that has never generated has no
    // directory for the first page to land in.
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content, 'utf8');
    process.stdout.write(`[composer] wrote ${outputPath}\n`);
  }

  // The module-owned pages, into the site's tree (feature 100 Phase 2, FR-016).
  // After the artefacts, because the sidebar names doc ids and Docusaurus
  // refuses one that names no page: a run that wrote the navigation and then
  // failed to place the pages has produced a site that cannot build, and this
  // ordering makes the failure land before the navigation is on disk rather
  // than after.
  const collected = collectDocsIntoSite();
  process.stdout.write(
    `[composer] collected ${collected.copied.length} module page(s) into ` +
      `${collected.modulesRoot}` +
      (collected.removed.length === 0 ? '' : `, removed ${collected.removed.length} stale copy/copies`) +
      '\n',
  );
}

// Only write when executed directly (not when imported by the determinism check).
//
// `--docs-only` is the documentation site's own entry point: it places the
// module-owned pages and touches no committed artefact. The site's `build` and
// `dev` scripts run it, because the copies are not committed and a site that
// collected nothing would build a navigation whose every entry names a page
// that is not there. It is deliberately *not* the full generator: a docs build
// that rewrote `composition.generated.ts` would repair the tree it is meant to
// be measured against, which is the reason `--check` never writes either.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--docs-only')) {
    const collected = collectDocsIntoSite();
    process.stdout.write(
      `[composer] collected ${collected.copied.length} module page(s) into ` +
        `${collected.modulesRoot}` +
        (collected.removed.length === 0
          ? ''
          : `, removed ${collected.removed.length} stale copy/copies`) +
        '\n',
    );
  } else {
    await main();
  }
}
