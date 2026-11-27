import type { ModuleManifest } from '@endora-commerce/contracts';
import type { HookableActionOwnership } from '../../commands/hooks/registry.js';
import type { CommandMiddlewareCompositionInput } from '../../commands/middleware/registry.js';

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
 * Every composed module's `buyerSelfServiceActions`, each with its owner
 * (`specs/193-admin-form-extensions/` D-300.10, issue #2027): the actions whose
 * Commands may declare `buyerSelfService`. The hook registry is sealed against
 * them, and the bus refuses the flag on any other action.
 */
export function buyerSelfServiceActionsFrom(
  manifests: readonly ModuleManifest[],
): readonly { readonly moduleId: string; readonly action: string }[] {
  return manifests.flatMap((manifest) => (manifest.buyerSelfServiceActions ?? []).map((action) => ({ moduleId: manifest.id, action })));
}

/**
 * Every composed module's `commandMiddleware` declarations, each with its
 * module (`specs/189-command-middleware/` FR-002, research R-12): what the
 * composer seals the command-middleware registry against, derived by the root
 * for `hookableActionsFrom`'s reason.
 */
export function commandMiddlewareFrom(
  manifests: readonly ModuleManifest[],
): CommandMiddlewareCompositionInput['declarations'] {
  return manifests.flatMap((manifest) =>
    (manifest.commandMiddleware ?? []).map((declaration) => ({ moduleId: manifest.id, ...declaration })),
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
