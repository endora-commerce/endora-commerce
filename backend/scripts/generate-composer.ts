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
 *   - `backend/src/modules/_lifecycle/registered-manifests.ts` — the manifest
 *     registry, which was a 317-line hand-maintained array.
 *
 * Why generate them (feature 072, FR-030..FR-040): adding a module was three
 * edits in files it does not own, and removing one was an archaeology exercise.
 * When the list is a filesystem walk, adding a module is adding a folder and
 * removing one is deleting it — which is the property US4 tests.
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
const registeredManifestsOutputPath = join(
  modulesRoot,
  '_lifecycle',
  'registered-manifests.ts',
);

/**
 * The one ordering constraint that is a **construction** dependency rather than
 * a manifest one, and therefore cannot be derived: `integrationsModule`
 * (`api_keys`) is composed first because its API-key authenticator is injected
 * into the auth plugin (`composition.ts:493`, consumed by the auth wiring).
 * `api_keys`' manifest declares nothing about `auth` — it is one of the
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

/** A module is *converted* when it ships a `backend.ts` exporting `registerModule`. */
function exposesRegisterModule(filePath: string): boolean {
  return /export\s+function\s+registerModule\s*\(/.test(readFileSync(filePath, 'utf8'));
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
    if (!existsSync(backend) || !exposesRegisterModule(backend)) continue;
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
      if (!existsSync(backend) || !exposesRegisterModule(backend)) continue;
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

/**
 * Registration order (FR-034): dependencies before dependents, the pinned
 * exception ahead of everything it does not itself depend on, overlay modules
 * last so a deployment's decoration wins, ties broken alphabetically so the
 * emitted file is a function of the tree and nothing else.
 *
 * Kahn's algorithm over the subgraph induced by the modules actually in the
 * list: a declared dependency on a module that is still hand-wired constrains
 * nothing here, because that module is not in this order at all.
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
// A module missing from this list is a module with no \`backend.ts\` — it is
// still hand-wired in \`composition.ts\` until its own conversion lands.

import type { ModuleEntry } from './kernel/compose.js';

${imports}

export const MODULES: readonly ModuleEntry[] = [
${entries}
];
`;
}

/** Pure render — the target path + expected content of the module composer. */
export async function renderComposer(): Promise<{ outputPath: string; content: string }> {
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
  hasInstallHook: boolean;
  hasUninstallHook: boolean;
}

/**
 * Every **core** module with a lifecycle-shape manifest. Overlay modules are
 * deliberately absent: they are merged at runtime by `resolvedManifestEntries`
 * below, because their `filePath` depends on the deployment the process runs
 * as, which a committed array cannot carry (FR-004 keeps the core array free of
 * per-deployment edits).
 */
function discoverManifests(): DiscoveredManifest[] {
  const out: DiscoveredManifest[] = [];
  for (const id of directoriesIn(modulesRoot)) {
    const manifestPath = join(modulesRoot, id, 'manifest.ts');
    if (!existsSync(manifestPath)) continue;
    const source = readFileSync(manifestPath, 'utf8');
    if (!/export\s+const\s+manifest\s*=\s*defineModuleManifest\(/.test(source)) continue;
    out.push({
      id,
      hasInstallHook: /export\s+const\s+installHook\s*[:=]/.test(source),
      hasUninstallHook: /export\s+const\s+uninstallHook\s*[:=]/.test(source),
    });
  }
  return out;
}

function emitRegisteredManifests(manifests: readonly DiscoveredManifest[]): string {
  const imports = manifests
    .map((m, i) => {
      const named = [`manifest as manifest${i}`];
      if (m.hasInstallHook) named.push(`installHook as installHook${i}`);
      if (m.hasUninstallHook) named.push(`uninstallHook as uninstallHook${i}`);
      return `import { ${named.join(', ')} } from '../${m.id}/manifest.js';`;
    })
    .join('\n');

  const entries = manifests
    .map((m, i) => {
      const fields = [`manifest: manifest${i}`, `filePath: pathFor('${m.id}')`];
      if (m.hasInstallHook) fields.push(`installHook: installHook${i}`);
      if (m.hasUninstallHook) fields.push(`uninstallHook: uninstallHook${i}`);
      return `  { ${fields.join(', ')} },`;
    })
    .join('\n');

  return `${HEADER('generate-composer.ts')}//
// The manifest registry: every core module that ships a lifecycle-shape
// \`manifest.ts\`. It used to be a hand-maintained array, so a module could ship
// a manifest and still contribute no permissions, no i18n bundle and no palette
// action because nobody remembered the third edit.
//
// Order is alphabetical and no consumer depends on it:
// \`collectRegisteredSettingsManifests()\` re-imposes its own (settings first,
// because every other module's settings fall back to its \`general\` group), and
// everything else topo-sorts or set-ifies.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';
import { DISCOVERED_MANIFESTS } from './manifest-index.generated.js';
import { overlayModulesRootFor, selectedDeployment } from '../../overlay/overlay-roots.js';

${imports}

/**
 * Each entry carries a real \`filePath\` so downstream reconcilers can locate the
 * module's directory on disk — notably the i18n bundle loader
 * (\`_i18n/plugin.ts\`) does \`dirname(entry.filePath)\` and joins \`bundlesDir\` to
 * find each module's \`i18n/<lang>.json\` files. Without a real path,
 * \`dirname('<static>')\` resolves to \`.\`, no bundle ever loads, and every action
 * label renders as its raw i18n key.
 */
export interface RegisteredManifestEntry {
  manifest: ModuleManifest;
  filePath: string;
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
}

/**
 * Convention: every module lives at \`backend/src/modules/<id>/manifest.ts\`.
 * \`import.meta.url\` points at this \`_lifecycle/registered-manifests.ts\`, so
 * \`dirname(dirname(...))\` lands on the modules root.
 */
const MODULES_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pathFor = (id: string): string => join(MODULES_ROOT, id, 'manifest.ts');

export const REGISTERED_MANIFESTS: ReadonlyArray<RegisteredManifestEntry> = [
${entries}
];

/**
 * The **deployment-resolved** manifest set = the generated core array PLUS any
 * overlay-only module discovered for the active deployment (feature 057).
 *
 * This stays a runtime merge on purpose: an overlay-only module's \`filePath\`
 * resolves against the deployment root, behind an \`existsSync\` guard, and the
 * answer depends on which deployment the process runs as — not on which tree it
 * was generated from. For a bare-core build (\`DEPLOYMENT\` unset) the generated
 * index contains only core modules, so this returns \`REGISTERED_MANIFESTS\`
 * unchanged (FR-008).
 */
export function resolvedManifestEntries(): RegisteredManifestEntry[] {
  const byId = new Map<string, RegisteredManifestEntry>(
    REGISTERED_MANIFESTS.map((e) => [e.manifest.id, e]),
  );
  const deployment = selectedDeployment();
  for (const discovered of DISCOVERED_MANIFESTS) {
    if (byId.has(discovered.id)) continue; // core module already registered
    // An overlay-only module: prefer a real core path if one somehow exists,
    // else resolve under the deployment's overlay tree.
    const corePath = pathFor(discovered.id);
    const filePath =
      existsSync(corePath) || deployment === null
        ? corePath
        : join(overlayModulesRootFor(deployment), discovered.id, 'manifest.ts');
    byId.set(discovered.id, { manifest: discovered.manifest, filePath });
  }
  return [...byId.values()];
}
`;
}

/** Pure render — the target path + expected content of the manifest registry. */
export function renderRegisteredManifests(): { outputPath: string; content: string } {
  return {
    outputPath: registeredManifestsOutputPath,
    content: emitRegisteredManifests(discoverManifests()),
  };
}

async function main(): Promise<void> {
  const rendered = [await renderComposer(), renderRegisteredManifests()];

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
