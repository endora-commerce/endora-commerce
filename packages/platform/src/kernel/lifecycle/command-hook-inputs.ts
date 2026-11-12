import type { ModuleManifest } from '@endora-commerce/contracts';
import type { HookableActionOwnership } from '../../commands/hooks/registry.js';

/**
 * What `composeModules` seals the command-hook registry against
 * (`specs/176-command-hooks-outbox/` FR-012, FR-013), derived by a root from
 * the manifests it resolved — beside `requiredModulesFrom`, for its reason:
 * the composer is handed data and never reads a manifest, and nothing here is
 * written down anywhere else (D-100).
 */

/** Every composed module's `hookableActions`, each with its owner. */
export function hookableActionsFrom(manifests: readonly ModuleManifest[]): readonly HookableActionOwnership[] {
  return manifests.flatMap((manifest) =>
    (manifest.hookableActions ?? []).map((declaration) => ({
      moduleId: manifest.id,
      action: declaration.action,
      objectType: declaration.objectType,
      phases: [...declaration.phases],
    })),
  );
}

/**
 * Each module's **transitive** `dependencies`, sorted. A hook module must reach
 * the action's owner through this closure, and the hooks of one action run in
 * the order it implies. An edge to a module outside the set is followed no
 * further but kept, and a cycle terminates — refusing either is the
 * lifecycle's job, not this derivation's.
 */
export function moduleDependencyClosureFrom(
  manifests: readonly ModuleManifest[],
): Readonly<Record<string, readonly string[]>> {
  const direct = new Map(manifests.map((manifest) => [manifest.id, manifest.dependencies ?? []]));
  const closure: Record<string, readonly string[]> = {};
  for (const manifest of manifests) {
    const reached = new Set<string>();
    const stack = [...(direct.get(manifest.id) ?? [])];
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === manifest.id || reached.has(next)) continue;
      reached.add(next);
      stack.push(...(direct.get(next) ?? []));
    }
    closure[manifest.id] = [...reached].sort();
  }
  return closure;
}
