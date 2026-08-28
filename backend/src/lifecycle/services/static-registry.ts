import type {
  ModuleInstallHook,
  ModuleLifecycleParticipant,
  ModuleManifest,
  ModuleRecentActivity,
  ModuleUninstallHook,
} from '@endora-commerce/contracts';
import { ModuleDepGraph } from './dep-graph.js';
import { collectLifecycleParticipants } from './manifest-loader.js';
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
/**
 * What {@link buildStaticRegistry} accepts.
 *
 * **Hand the resolved entries straight in; do not re-map them.** Five CLI
 * scripts, `composition.ts` and the test harness each carried a hand-written
 * identity map from `RegisteredManifestEntry` into this shape, field by field —
 * seven copies of one function, of which `status.ts` had already dropped
 * `filePath` and every one of them would have dropped the
 * `lifecycleParticipant` added in feature 080's T036a. The two types are
 * structurally compatible on purpose, so there is nothing to copy.
 *
 * Every optional field spells `| undefined` explicitly, and that is what makes
 * the compatibility hold: under `exactOptionalPropertyTypes` a bare `?:`
 * refuses a value whose own property is typed `T | undefined`, which is what
 * every carrier of these fields has.
 */
export interface StaticRegistryEntry {
  manifest: ModuleManifest;
  installHook?: ModuleInstallHook | undefined;
  uninstallHook?: ModuleUninstallHook | undefined;
  /**
   * This module's interest in every *other* module's install and hard
   * uninstall (feature 080, T036a / D-159).
   */
  lifecycleParticipant?: ModuleLifecycleParticipant | undefined;
  /**
   * The module's recent-activity eligibility (feature 080, T042j / D-163.1).
   */
  recentActivity?: ModuleRecentActivity | undefined;
  /** Optional source-file path for diagnostics; defaults to `'<static>'`. */
  filePath?: string | undefined;
}

export function buildStaticRegistry(
  entries: ReadonlyArray<StaticRegistryEntry>,
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
      ...(e.lifecycleParticipant ? { lifecycleParticipant: e.lifecycleParticipant } : {}),
      ...(e.recentActivity ? { recentActivity: e.recentActivity } : {}),
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
  return { modules, graph, participants: collectLifecycleParticipants(modules.values()) };
}
