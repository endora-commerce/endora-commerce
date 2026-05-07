import { readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
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
 */
export async function discoverManifests<EM = unknown, R = unknown>(
  opts: DiscoverOptions,
): Promise<LoadedManifestRegistry<EM, R>> {
  const root = resolve(opts.modulesRoot);
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
          `folder "${folderName}" — they MUST match (Principle VI).`,
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

/** Module folder name typically becomes the id; this helper formalises that. */
export function folderNameFromPath(filePath: string): string {
  return basename(dirname(filePath));
}
