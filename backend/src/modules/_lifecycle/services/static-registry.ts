import type {
  ModuleInstallHook,
  ModuleManifest,
  ModuleUninstallHook,
} from '@b2b/contracts';
import { ModuleDepGraph } from './dep-graph.js';
import type { LoadedManifestRegistry, LoadedModuleEntry } from './manifest-loader.js';

/**
 * Build a `LoadedManifestRegistry` from static imports — what the
 * production composition root uses instead of filesystem discovery.
 *
 * Why a separate path? `composition.ts` already imports every module's
 * plugin via static `import` statements (so the build picks them up).
 * Asking the same code to do filesystem discovery in production would
 * require shipping the source tree alongside `dist/`, which we don't.
 * The CLI scripts (which run via `tsx` against the source tree) and
 * tests (which run via vitest, ditto) use the dynamic discovery loader.
 */
export function buildStaticRegistry(
  entries: ReadonlyArray<{
    manifest: ModuleManifest;
    installHook?: ModuleInstallHook;
    uninstallHook?: ModuleUninstallHook;
    /** Optional source-file path for diagnostics; defaults to `'<static>'`. */
    filePath?: string;
  }>,
): LoadedManifestRegistry {
  const modules = new Map<string, LoadedModuleEntry>();
  for (const e of entries) {
    if (modules.has(e.manifest.id)) {
      throw new Error(
        `[static-registry] duplicate manifest id "${e.manifest.id}" — ` +
          `composition root must declare each module exactly once.`,
      );
    }
    modules.set(e.manifest.id, {
      manifest: e.manifest,
      filePath: e.filePath ?? '<static>',
      ...(e.installHook ? { installHook: e.installHook } : {}),
      ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
    });
  }
  // Orphan deps: per research §R7, BOOT IS TOLERANT — modules whose
  // dependencies haven't been retrofitted yet (Pass B is a separate
  // feature) are accepted with a warning. The orchestrator's install/
  // enable validation re-checks against the registry at command time
  // and refuses misconfigured installs.
  for (const e of modules.values()) {
    for (const dep of e.manifest.dependencies) {
      if (!modules.has(dep)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[static-registry] manifest "${e.manifest.id}" depends on ` +
            `"${dep}" which is not in the static registry — ` +
            `treating as always-installed (Pass B retrofit pending).`,
        );
      }
    }
  }
  const graph = new ModuleDepGraph(
    [...modules.values()].map((m) => m.manifest),
  );
  const cycle = graph.hasCycle();
  if (cycle) {
    throw new Error(
      `[static-registry] cycle in module dependency graph: ` +
        `[${cycle.cycle.join(' → ')}]`,
    );
  }
  return { modules, graph };
}
