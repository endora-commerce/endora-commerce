import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, basename, resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ModuleManifestSchema,
  type ModuleManifest,
  type ModuleInstallHook,
  type ModuleUninstallHook,
  type ModuleManifestExports,
} from '@b2b/contracts';
import { ModuleDepGraph } from './dep-graph.js';

export interface LoadedModuleEntry<EM = unknown, R = unknown> {
  manifest: ModuleManifest;
  /** Absolute path to the manifest.ts file on disk. */
  filePath: string;
  installHook?: ModuleInstallHook<EM, R>;
  uninstallHook?: ModuleUninstallHook<EM, R>;
}

export interface LoadedManifestRegistry<EM = unknown, R = unknown> {
  modules: Map<string, LoadedModuleEntry<EM, R>>;
  graph: ModuleDepGraph;
}

export class ManifestLoadError extends Error {
  constructor(
    public readonly kind:
      | 'duplicate-id'
      | 'cycle'
      | 'self-dep'
      | 'orphan-dep'
      | 'folder-id-mismatch'
      | 'package-root'
      | 'parse-failed',
    message: string,
  ) {
    super(message);
    this.name = 'ManifestLoadError';
  }
}

export interface DiscoverOptions {
  /** Root directory to scan (e.g. `backend/src/modules`). */
  modulesRoot: string;
  /**
   * Subdirectories under `modulesRoot` that the loader should INCLUDE.
   * Defaults to "every direct subdirectory". Used by tests to scope
   * discovery to a single fixture tree.
   */
  include?: readonly string[];
  /**
   * Names of subdirectories under `modulesRoot` to ignore (e.g.
   * `__pycache__`-like or test fixtures). Defaults to none.
   */
  exclude?: readonly string[];
}

/**
 * Discover every `manifest.ts` under `modulesRoot/<id>/manifest.ts` and
 * dynamically import each module. Returns the validated registry plus
 * the dep graph derived from declarations.
 *
 * Production builds may swap this loader for a generated
 * `manifest-index.ts` that imports the same modules eagerly — this
 * runtime path is for dev/test where the file system is the source of
 * truth.
 *
 * **Identity here is the directory name, and that scopes this loader** (feature
 * 080, T032). It walks a tree this repository lays out, where Principle VI says
 * `<id>/manifest.ts` — so the folder name is a claim about the id and a
 * disagreement is a defect. An **installed package** has neither property: its
 * directory is its npm name (`@endora-commerce/mod-blog`), and its identity is
 * the `endora.id` field of its `package.json` (D-142), checked against its
 * manifest by `src/packages/package-runtime.ts`. Pointing this loader at a
 * `node_modules` is therefore refused outright rather than walked — see
 * {@link ManifestLoadError} kind `package-root`. Without that refusal the walk
 * happens to work and then reports `folder-id-mismatch`, which blames a vendor
 * for naming their package correctly and sends the reader to fix the one thing
 * that is right.
 */
export async function discoverManifests<EM = unknown, R = unknown>(
  opts: DiscoverOptions,
): Promise<LoadedManifestRegistry<EM, R>> {
  const root = resolve(opts.modulesRoot);
  // Before the walk, not inside it: a `node_modules` must not be readable as a
  // modules tree at all, whatever it happens to contain.
  if (root.split(sep).includes('node_modules')) {
    throw new ManifestLoadError(
      'package-root',
      `${root} is inside a node_modules tree, and this loader derives a module's id from its ` +
        `folder name. An installed package's folder is its npm name and its id is the ` +
        `"endora.id" field of its package.json (D-142), so discovering one here would either ` +
        `refuse it as a folder-id-mismatch or give it the wrong id. Use ` +
        `loadPackageModuleEntries / discoverPackageModuleManifests (src/packages/) instead.`,
    );
  }
  const exclude = new Set(opts.exclude ?? []);
  const candidates: string[] = [];

  if (opts.include && opts.include.length > 0) {
    for (const sub of opts.include) candidates.push(sub);
  } else {
    for (const entry of readdirSync(root)) {
      if (exclude.has(entry)) continue;
      const full = join(root, entry);
      if (!statSync(full).isDirectory()) continue;
      candidates.push(entry);
    }
  }

  const modules = new Map<string, LoadedModuleEntry<EM, R>>();

  for (const folderName of candidates) {
    const filePath = join(root, folderName, 'manifest.ts');
    if (!existsSync(filePath)) continue;

    let imported: ModuleManifestExports<EM, R>;
    try {
      imported = (await import(pathToFileURL(filePath).href)) as ModuleManifestExports<EM, R>;
    } catch (err) {
      throw new ManifestLoadError(
        'parse-failed',
        `failed to import manifest at ${filePath}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    const manifest = imported.manifest;
    if (!manifest) {
      throw new ManifestLoadError(
        'parse-failed',
        `manifest.ts at ${filePath} does not export a "manifest" constant`,
      );
    }
    // Re-parse defensively — `defineModuleManifest` already validates,
    // but a hand-rolled export might not have used the helper.
    const parsed = ModuleManifestSchema.parse(manifest);

    if (parsed.id !== folderName) {
      throw new ManifestLoadError(
        'folder-id-mismatch',
        `manifest at ${filePath} declares id "${parsed.id}" but lives in ` +
          `folder "${folderName}" — in a directory-named module tree they MUST match ` +
          `(Principle VI). An installed package is the other case and never reaches here: ` +
          `its id is its "endora.id" field, not its folder.`,
      );
    }
    if (parsed.dependencies.includes(parsed.id)) {
      throw new ManifestLoadError(
        'self-dep',
        `manifest "${parsed.id}" depends on itself.`,
      );
    }
    const existing = modules.get(parsed.id);
    if (existing) {
      throw new ManifestLoadError(
        'duplicate-id',
        `manifest id "${parsed.id}" is declared by both ` +
          `${existing.filePath} and ${filePath}.`,
      );
    }
    if (parsed.settings && parsed.settings.moduleCode !== parsed.id) {
      throw new ManifestLoadError(
        'parse-failed',
        `manifest "${parsed.id}" carries a settings manifest with ` +
          `moduleCode "${parsed.settings.moduleCode}" — must match.`,
      );
    }

    modules.set(parsed.id, {
      manifest: parsed,
      filePath,
      ...(imported.installHook ? { installHook: imported.installHook } : {}),
      ...(imported.uninstallHook ? { uninstallHook: imported.uninstallHook } : {}),
    });
  }

  // Verify every dependency points to a known module before building
  // the graph (cycles in subgraphs of unknown nodes would mask).
  for (const entry of modules.values()) {
    for (const dep of entry.manifest.dependencies) {
      if (!modules.has(dep)) {
        throw new ManifestLoadError(
          'orphan-dep',
          `manifest "${entry.manifest.id}" depends on "${dep}" but no ` +
            `manifest with that id was discovered under ${root}.`,
        );
      }
    }
  }

  const graph = new ModuleDepGraph([...modules.values()].map((e) => e.manifest));
  const cycle = graph.hasCycle();
  if (cycle) {
    throw new ManifestLoadError(
      'cycle',
      `cycle detected in module dependency graph: [${cycle.cycle.join(' → ')}]`,
    );
  }

  return { modules, graph };
}

/**
 * Convenience for tests: resolve `modulesRoot` relative to a test file.
 * Avoids hard-coding paths that break under different working dirs.
 */
export function resolveFromFile(metaUrl: string, relative: string): string {
  return resolve(dirname(fileURLToPath(metaUrl)), relative);
}

/** Test helper — assert that a value is one of the known load-error kinds. */
export function isLoadError(
  err: unknown,
): err is ManifestLoadError {
  return err instanceof ManifestLoadError;
}

/**
 * Production loader entry point: scans the project's
 * `backend/src/modules` for every `manifest.ts`. Skips the fixtures
 * trees under `test/`. Used by `composition.ts` at boot.
 */
export async function loadProjectManifests<EM = unknown, R = unknown>(
  modulesRoot: string,
): Promise<LoadedManifestRegistry<EM, R>> {
  return discoverManifests<EM, R>({
    modulesRoot,
    exclude: [],
  });
}

/**
 * The folder name a **directory-named** module's id comes from.
 *
 * It answers for the anchor {@link discoverManifests} produces — a
 * `manifest.ts` under `<modules root>/<id>/`. It refuses a `package.json`
 * anchor, which is what a resolved package entry's `filePath` is (feature 080,
 * T032): `basename(dirname(...))` would answer `mod-blog`, the tail of an npm
 * name, which is neither the module id nor even unique without the `@scope`
 * this drops. A confident wrong answer is worse than a refusal — a package's id
 * is its `endora.id`, and `resolvedManifestEntries()` already carries it.
 */
export function folderNameFromPath(filePath: string): string {
  if (basename(filePath) === 'package.json') {
    throw new ManifestLoadError(
      'package-root',
      `${filePath} is a package.json, so it anchors an installed package rather than a ` +
        `directory-named module. A package's id is its "endora.id" field (D-142), not its ` +
        `folder name; read it from the manifest entry instead of deriving it from the path.`,
    );
  }
  return basename(dirname(filePath));
}
