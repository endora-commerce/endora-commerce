#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generates the four files that name every module by hand today:
 *
 *   - `backend/src/composition.generated.ts` — the list a composition root
 *     walks: one `{ id, version, registerModule }` entry per converted **core**
 *     module, in the order it must be composed.
 *   - `backend/src/modules/_lifecycle/manifest-index.generated.ts` — the one
 *     manifest registry: every core module's manifest, plus the install hooks
 *     it exports.
 *   - `backend/src/db/entities-registry.generated.ts` — the explicit entity
 *     class list MikroORM discovers through.
 *   - `backend/src/db/migrations-registry.generated.ts` — every migration in
 *     the repository, with the module that owns it.
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
  discoverModulePackages,
  isDeclaredEntryPoint,
  ModulePackageError,
  packageSpecifierFor,
  type ModulePackage,
} from './lib/module-packages.js';
import {
  platformSourceRootAt,
  platformSubpathsAt,
  PlatformRootUnresolvableError,
} from './lib/platform-root.js';
import { declaresRegisterModule } from './lib/module-roots.js';

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
const manifestIndexOutputPath = join(
  modulesRoot,
  '_lifecycle',
  'manifest-index.generated.ts',
);
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
const manifestLocationsPath = join(modulesRoot, '_lifecycle', 'manifest-locations.ts');
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
 */
export const GENERATED_ARTIFACT_PATHS: readonly string[] = [
  composerOutputPath,
  manifestIndexOutputPath,
  entitiesRegistryOutputPath,
  migrationsRegistryOutputPath,
];

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
// to this list in the one \`composeModules\` call, which is what makes "overlay
// last, so a deployment's \`di.decorate\` wins" structural rather than a property
// of this generator's sort — and what keeps this committed artefact meaning the
// same thing in every environment.
//
// A module missing from this list is a module the tree walk found no
// \`backend.ts\` for. Every core module exports \`registerModule\` today, so an
// absence here means a file was not written or not named \`backend.ts\` — not
// that the module is composed somewhere else.

import type { ModuleEntry } from './kernel/compose.js';

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
): DiscoveredManifest[] {
  const byId = new Map<string, DiscoveredManifest>();
  const entryFrom = (id: string, source: string, importPath: string): DiscoveredManifest => ({
    id,
    importPath,
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
  // The index lives in `_lifecycle/`, so a core manifest is one folder up.
  for (const id of directoriesIn(modulesRoot)) {
    const manifestPath = join(modulesRoot, id, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    const source = readFileSync(manifestPath, 'utf8');
    if (!/export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(source)) continue;
    byId.set(id, entryFrom(id, source, `../${id}/manifest.js`));
  }
  // A packaged module's manifest is imported by the **bare** specifier its own
  // exports map publishes (D-149), so this artefact does not change on the day
  // the package stops being a workspace member and starts being installed.
  for (const pkg of packages) {
    const entry = packageEntryPoints(pkg);
    byId.set(
      pkg.moduleId,
      entryFrom(pkg.moduleId, readFileSync(entry.manifestPath, 'utf8'), entry.manifestSpecifier),
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
 * Relative for the application's own tree — `./migration-order.js` for a
 * sibling under `db/`, `../modules/blog/…` for anything else — and **bare** for
 * a module package, which is what keeps the artefact unchanged on the day that
 * package stops being a workspace member and starts being installed. The bare
 * form is derived from the package's own `exports` map rather than assembled
 * from a subpath written here; see `lib/module-packages.ts`.
 */
function specifierFor(file: string, owner: ModulePackage | null): string {
  if (owner !== null) return packageSpecifierFor(owner, file);
  const asJs = file.replace(/\.ts$/, '.js');
  return asJs.startsWith('db/') ? `./${asJs.slice('db/'.length)}` : `../${asJs}`;
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
  /** Owning module id — `core` for `src/db/migrations/`. */
  readonly moduleId: string;
  readonly className: string;
  /** Path of the migration file, relative to its own root. */
  readonly file: string;
  /** The module package that owns it, or `null` for the application's tree. */
  readonly owner: ModulePackage | null;
}

/** `src/db/migrations/<file>` and `src/modules/<id>/migrations/<file>`. */
const CORE_MIGRATION_RE = /^db\/migrations\/([^/]+\.ts)$/;
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
import type { MigrationClass, MigrationRegistryEntry } from './migration-order.js';
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

/** Every committed artefact, rendered from one read of the tree. */
export async function renderAll(): Promise<
  ReadonlyArray<{ label: string; outputPath: string; content: string }>
> {
  const packages = modulePackages();
  const sources = readSourceTree(packages);
  const composer = await renderComposer();
  return [
    { label: 'composition.generated', ...composer },
    { label: 'manifest-index', ...renderManifestIndex(packages) },
    { label: 'entities-registry', ...renderEntitiesRegistry(sources) },
    { label: 'migrations-registry', ...renderMigrationsRegistry(sources) },
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
    writeFileSync(outputPath, content, 'utf8');
    process.stdout.write(`[composer] wrote ${outputPath}\n`);
  }
}

// Only write when executed directly (not when imported by the determinism check).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
