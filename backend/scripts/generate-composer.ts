#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generates the four files that name every module by hand today:
 *
 *   - `backend/src/composition.generated.ts` — the list a composition root
 *     walks: one `{ id, version, registerModule }` entry per converted module,
 *     in the order it must be composed.
 *   - `backend/src/modules/_lifecycle/manifest-index.generated.ts` — the one
 *     manifest registry: every module's manifest, plus the install hooks it
 *     exports and whether it came from a deployment's overlay tree.
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

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, '../src');
const modulesRoot = join(srcRoot, 'modules');

const composerOutputPath = join(srcRoot, 'composition.generated.ts');
const manifestIndexOutputPath = join(
  modulesRoot,
  '_lifecycle',
  'manifest-index.generated.ts',
);
const entitiesRegistryOutputPath = join(srcRoot, 'db', 'entities-registry.generated.ts');
const migrationsRegistryOutputPath = join(srcRoot, 'db', 'migrations-registry.generated.ts');

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
  /** A per-deployment overlay module (feature 057) — composed after core. */
  readonly isOverlay: boolean;
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
  if (/export\s+(?:function|const|let|async\s+function)\s+registerModule\b/.test(source)) {
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

function overlayRoot(): { deployment: string; root: string } | null {
  const deployment = process.env['DEPLOYMENT']?.trim();
  if (!deployment) return null;
  const root = resolve(srcRoot, 'apps', deployment, 'modules');
  return existsSync(root) ? { deployment, root } : null;
}

interface DiscoveredConverted {
  id: string;
  isOverlay: boolean;
  /** Absolute path to the module's directory — read for `manifest.dependencies`. */
  dir: string;
  backendImportPath: string;
  manifestImportPath: string;
}

/**
 * Every converted module: core first, then the active deployment's overlay. An
 * overlay module with a core module's id shadows it, exactly as the manifest
 * index resolves it.
 */
function discoverConverted(): DiscoveredConverted[] {
  const byId = new Map<string, DiscoveredConverted>();
  for (const id of directoriesIn(modulesRoot)) {
    const backend = join(modulesRoot, id, 'backend.ts');
    if (!existsSync(backend)) continue;
    exposesRegisterModule(backend);
    byId.set(id, {
      id,
      isOverlay: false,
      dir: join(modulesRoot, id),
      backendImportPath: `./modules/${id}/backend.js`,
      manifestImportPath: `./modules/${id}/manifest.js`,
    });
  }
  const overlay = overlayRoot();
  if (overlay) {
    for (const id of directoriesIn(overlay.root)) {
      const backend = join(overlay.root, id, 'backend.ts');
      if (!existsSync(backend)) continue;
      exposesRegisterModule(backend);
      byId.set(id, {
        id,
        isOverlay: true,
        dir: join(overlay.root, id),
        backendImportPath: `./apps/${overlay.deployment}/modules/${id}/backend.js`,
        manifestImportPath: `./apps/${overlay.deployment}/modules/${id}/manifest.js`,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Reads `dependencies` off the module's real manifest rather than parsing the
 * source: the manifest is the declaration the ordering is supposed to follow,
 * and a regex would answer `[]` for anything it failed to recognise — which is
 * a wrong order that boots and then fails somewhere else.
 */
async function loadManifest(dir: string): Promise<{ id: string; dependencies: string[] }> {
  const mod = (await import(pathToFileURL(join(dir, 'manifest.ts')).href)) as {
    manifest?: { id?: string; dependencies?: readonly string[] };
  };
  const manifest = mod.manifest;
  if (!manifest?.id) {
    throw new Error(`[composer] ${dir}/manifest.ts exports no lifecycle-shape manifest`);
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
 * Scope is deliberately **every present module**, including overlay ones the
 * emitted list does not order: a dangling declaration is wrong wherever it is
 * declared, and the generator is the only place in the build that already has
 * the whole manifest set in front of it.
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

/**
 * Every module in the tree that ships a lifecycle-shape manifest — core plus
 * the active deployment's overlay, an overlay id shadowing the core one.
 */
async function discoverPresentModules(): Promise<PresentModule[]> {
  const byId = new Map<string, PresentModule>();
  const collect = async (root: string): Promise<void> => {
    for (const id of directoriesIn(root)) {
      const manifestPath = join(root, id, 'manifest.ts');
      if (!existsSync(manifestPath)) continue;
      if (!/export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(readFileSync(manifestPath, 'utf8'))) {
        continue;
      }
      byId.set(id, await loadManifest(join(root, id)));
    }
  };
  await collect(modulesRoot);
  const overlay = overlayRoot();
  if (overlay) await collect(overlay.root);
  return [...byId.values()];
}

/**
 * Registration order (FR-034): dependencies before dependents, the pinned
 * exception ahead of everything it does not itself depend on, overlay modules
 * last so a deployment's decoration wins, ties broken alphabetically so the
 * emitted file is a function of the tree and nothing else.
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

  const rank = (node: ComposerNode): number => {
    if (PINNED_FIRST.includes(node.id)) return 0;
    return node.isOverlay ? 2 : 1;
  };
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
 * Pure render of the composer array. Exported so the one fact the kernel's
 * ownership guard depends on — that a deployment's module is emitted as
 * `overlay: true` — is proved here, at the place that decides it, rather than
 * by a test that sets the flag by hand (issue #203).
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
    .map((n, i) => {
      // `overlay` is emitted only where it is true, so the bare-core artefact
      // is unchanged and a core entry has no field for a reader to mistake.
      const overlay = n.isOverlay ? 'overlay: true, ' : '';
      return `  { id: '${n.id}', version: manifest${i}.version, ${overlay}registerModule: module${i}.registerModule },`;
    })
    .join('\n');

  return `${HEADER('generate-composer.ts')}//
// Every module that ships a \`backend.ts\` exporting \`registerModule\`, in the
// order a composition root must compose them:
//
//   1. \`${PINNED_FIRST.join('\`, \`')}\` first — a **construction** dependency, not a manifest one:
//      the API-key authenticator is injected into the auth plugin, and
//      \`api_keys\`' manifest declares nothing about \`auth\`. Pinned here, in the
//      open, until F3 fixes the declaration.
//   2. then a topological order over \`manifest.dependencies\`, ties broken
//      alphabetically so this file is a function of the tree and nothing else.
//   3. overlay modules (feature 057) last, so a deployment's \`di.decorate\`
//      wins over the core registration it decorates. They carry
//      \`overlay: true\`, which is what exempts them from the kernel's rule
//      that a module may decorate only what it registered (issue #203).
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
  assertDependenciesPresent(await discoverPresentModules());
  const discovered = discoverConverted();
  const nodes: ComposerNode[] = [];
  for (const entry of discovered) {
    const manifest = await loadManifest(entry.dir);
    if (manifest.id !== entry.id) {
      throw new Error(
        `[composer] ${entry.id}/manifest.ts declares id '${manifest.id}'; a module's folder name is its id`,
      );
    }
    nodes.push({
      id: entry.id,
      dependencies: manifest.dependencies,
      isOverlay: entry.isOverlay,
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
  /** Discovered under the active deployment's overlay tree (feature 057). */
  isOverlay: boolean;
  hasInstallHook: boolean;
  hasUninstallHook: boolean;
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
 * Every module with a lifecycle-shape manifest: core first, then the active
 * deployment's overlay tree (feature 057). An overlay manifest for a core id
 * shadows the core one, so the index imports exactly one manifest per id — the
 * property `resolvedManifestEntries()` relies on when it merges.
 *
 * The overlay half is why `DEPLOYMENT` changes the output: the committed
 * artefact is the bare-core render, and a per-deployment build runs this same
 * generator with `DEPLOYMENT=<name>` set.
 */
function discoverManifests(): DiscoveredManifest[] {
  const byId = new Map<string, DiscoveredManifest>();
  const collect = (root: string, importPathFor: (id: string) => string, isOverlay: boolean): void => {
    for (const id of directoriesIn(root)) {
      const manifestPath = join(root, id, 'manifest.ts');
      if (!existsSync(manifestPath)) continue;
      const source = readFileSync(manifestPath, 'utf8');
      if (!/export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(source)) continue;
      byId.set(id, {
        id,
        importPath: importPathFor(id),
        isOverlay,
        hasInstallHook: detectHookExport('installHook', source, id),
        hasUninstallHook: detectHookExport('uninstallHook', source, id),
      });
    }
  };
  // The index lives in `_lifecycle/`, so a core manifest is one folder up and a
  // deployment's is two, through `apps/<deployment>/modules/`.
  collect(modulesRoot, (id) => `../${id}/manifest.js`, false);
  const overlay = overlayRoot();
  if (overlay) {
    collect(overlay.root, (id) => `../../apps/${overlay.deployment}/modules/${id}/manifest.js`, true);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function emitManifestIndex(manifests: readonly DiscoveredManifest[]): string {
  const imports = manifests
    .map((m, i) => {
      const named = [`manifest as manifest${i}`];
      if (m.hasInstallHook) named.push(`installHook as installHook${i}`);
      if (m.hasUninstallHook) named.push(`uninstallHook as uninstallHook${i}`);
      return `import { ${named.join(', ')} } from '${m.importPath}';`;
    })
    .join('\n');

  const entries = manifests
    .map((m, i) => {
      const fields = [`id: '${m.id}'`, `manifest: manifest${i}`];
      if (m.isOverlay) fields.push('overlay: true');
      if (m.hasInstallHook) fields.push(`installHook: installHook${i}`);
      if (m.hasUninstallHook) fields.push(`uninstallHook: uninstallHook${i}`);
      return `  { ${fields.join(', ')} },`;
    })
    .join('\n');

  return `${HEADER('generate-composer.ts')}//
// The manifest registry — the **only** file that imports a module's manifest.
// Every module that ships a lifecycle-shape \`manifest.ts\` is here, with the
// install hooks it exports and, for a per-deployment build, the overlay modules
// of the selected deployment.
//
// It used to have a twin (\`registered-manifests.ts\`) importing the same
// manifests behind a second command, which is a drift waiting to happen; that
// file now derives its entries from this array instead.
//
// Order is alphabetical and no consumer depends on it:
// \`collectRegisteredSettingsManifests()\` re-imposes its own (settings first,
// because every other module's settings fall back to its \`general\` group), and
// everything else topo-sorts or set-ifies.

import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';

${imports}

export interface DiscoveredManifestEntry {
  id: string;
  manifest: ModuleManifest;
  /**
   * Present only for a module found under the active deployment's overlay tree.
   * It is what keeps the core registry deployment-free (feature 057, FR-004)
   * and what tells the runtime merge to resolve the module's directory under
   * \`apps/<deployment>/modules/\` rather than under the core modules root.
   */
  overlay?: true;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
}

export const DISCOVERED_MANIFESTS: ReadonlyArray<DiscoveredManifestEntry> = [
${entries}
];
`;
}

/** Pure render — the target path + expected content of the manifest registry. */
export function renderManifestIndex(): { outputPath: string; content: string } {
  return {
    outputPath: manifestIndexOutputPath,
    content: emitManifestIndex(discoverManifests()),
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

/** Every hand-written `.ts` source under `src/`, keyed by its `src`-relative path. */
export type SourceTree = ReadonlyMap<string, string>;

/**
 * A generated artefact is **output, not input**. Excluding `*.generated.ts` is
 * not tidiness: the emitted registries quote the decorators and paths they
 * scanned for, so reading them back made the second run of the generator
 * disagree with the first — which is the one property a committed artefact must
 * never lack.
 */
function readSourceTree(root: string = srcRoot, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(root).sort()) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const full = join(root, name);
    const relativePath = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) {
      readSourceTree(full, relativePath, out);
    } else if (
      name.endsWith('.ts') &&
      !name.endsWith('.d.ts') &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.generated.ts')
    ) {
      out.set(relativePath, readFileSync(full, 'utf8'));
    }
  }
  return out;
}

/** Import specifier from a file in `src/db/` to a `src`-relative source file. */
function specifierFromDb(file: string): string {
  const asJs = file.replace(/\.ts$/, '.js');
  return asJs.startsWith('db/') ? `./${asJs.slice('db/'.length)}` : `../${asJs}`;
}

/** One `@Entity`-decorated class, as the generator sees it. */
export interface DiscoveredEntity {
  readonly className: string;
  /** `src`-relative path of the file declaring it. */
  readonly file: string;
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
  for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
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
    if (file.startsWith('apps/')) {
      throw new Error(
        `[composer] ${file} declares an entity under a deployment overlay. The entity and ` +
          `migration registries are core-only: an overlay module cannot ship a migration ` +
          `today, so an overlay entity would be ORM metadata for a table nothing creates. ` +
          `Ship the schema from a core module, or make overlay migrations run first.`,
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
      found.push({ className, file });
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
// it does not find its own output. The walk is core-only: an overlay module cannot
// ship a migration today, so an overlay entity is refused by the generator
// rather than registered for a table nothing creates.
`;
}

/** Pure emit — the entity registry's content for a given set of entities. */
export function emitEntitiesRegistry(entities: readonly DiscoveredEntity[]): string {
  const imports = entities
    .map((entity) => `import { ${entity.className} } from '${specifierFromDb(entity.file)}';`)
    .join('\n');
  const listed = entities.map((entity) => `  ${entity.className},`).join('\n');
  return `${emitEntitiesHeader()}
${imports}

export const ALL_ENTITIES = [
${listed}
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

/** contracts/naming-convention.md §4 — non-migration helpers in a migrations/ dir. */
const MIGRATION_HELPER_ALLOW_LIST = new Set([
  'modules/quote_requests/migrations/status-mapping.ts',
]);

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
  /** `src`-relative path of the migration file. */
  readonly file: string;
}

/** `src/db/migrations/<file>` and `src/modules/<id>/migrations/<file>`. */
const CORE_MIGRATION_RE = /^db\/migrations\/([^/]+\.ts)$/;
const MODULE_MIGRATION_RE = /^modules\/([^/]+)\/migrations\/([^/]+\.ts)$/;
const OVERLAY_MIGRATION_RE = /^apps\/[^/]+\/modules\/[^/]+\/migrations\//;

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
export function collectMigrations(sources: SourceTree): DiscoveredMigration[] {
  const found: DiscoveredMigration[] = [];
  const byClassName = new Map<string, string>();
  for (const [file, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    if (OVERLAY_MIGRATION_RE.test(file)) {
      throw new Error(
        `[composer] ${file} is a migration under a deployment overlay. The migration ` +
          `registry is core-only, so an overlay migration is never executed — registering ` +
          `it here would be a new capability, not a side effect of generating the list. ` +
          `Move the schema into a core module.`,
      );
    }
    const core = CORE_MIGRATION_RE.exec(file);
    const owned = MODULE_MIGRATION_RE.exec(file);
    if (!core && !owned) continue;
    const moduleId = core ? 'core' : owned![1]!;
    const filename = core ? core[1]! : owned![2]!;
    if (!MIGRATION_FILE_RE.test(filename)) {
      if (MIGRATION_HELPER_ALLOW_LIST.has(file)) continue;
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
    found.push({ moduleId, className, file });
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
// migration-order.ts from each migration's UTC timestamp, corrected by the
// module-manifest dependency graph, with UNCORRECTED_THROUGH marking the
// pre-065 block that is emitted chronologically. Entries below are grouped by
// owning module purely so the diff reads; never "fix" an ordering surprise by
// moving a line, and there is nothing to move — regenerating restores it. Bump
// the timestamp or fix the manifest \`dependencies\` instead.
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
    imports.push(`import { ${entry.className} } from '${specifierFromDb(entry.file)}';`);
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
  const sources = readSourceTree();
  const composer = await renderComposer();
  return [
    { label: 'composition.generated', ...composer },
    { label: 'manifest-index', ...renderManifestIndex() },
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
