#!/usr/bin/env tsx
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Generates the two files that name every module by hand today:
 *
 *   - `backend/src/composition.generated.ts` — the list a composition root
 *     walks: one `{ id, version, registerModule }` entry per converted module,
 *     in the order it must be composed.
 *   - `backend/src/modules/_lifecycle/manifest-index.generated.ts` — the one
 *     manifest registry: every module's manifest, plus the install hooks it
 *     exports and whether it came from a deployment's overlay tree.
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
 * Usage:
 *   pnpm --filter backend run composer:generate
 *
 * Both outputs are committed so a build needs no filesystem walk and so a
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

function emitComposer(nodes: readonly ComposerNode[]): string {
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
//      wins over the core registration it decorates.
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

async function main(): Promise<void> {
  const rendered = [await renderComposer(), renderManifestIndex()];

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
