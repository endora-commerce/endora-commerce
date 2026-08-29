/**
 * The generated admin registry, flattened into what the two host surfaces
 * render (feature 091, Phase 2).
 *
 * `admin/src/modules.generated.ts` is a list of module contribution sets;
 * `App.tsx` needs routes and `AppShell.tsx` needs nav entries, each carrying
 * the **owner** so the one visibility predicate can filter on it. Attribution
 * is added here rather than declared by the module, for D-142's reason: the
 * registry entry's key is the module id, so a declaration cannot claim to
 * belong to a module other than the one that shipped it.
 *
 * **Nothing here filters.** `isSurfaceVisible` decides presence and permission
 * at render, because an operator's activation flip must take effect without a
 * rebuild (Principle XVII item 5, and D-67/D-68's boot-hook case pointed at the
 * frontend). The registry answers *"what could be here"*; the predicate answers
 * *"what is here for this operator right now"*.
 */
import type {
  AdminNavDeclaration,
  AdminRouteDeclaration,
} from '@endora-commerce/admin-kit/contributions';

import { MODULE_ADMIN_CONTRIBUTIONS } from '../../modules.generated.js';

/** A declaration with the module that shipped it. */
export type OwnedBy<T> = T & { readonly module: string };

/**
 * Two modules declaring the same route `path`, refused at module scope.
 *
 * Not last-one-wins: `react-router` silently takes the first match, so the
 * second module's screen would be unreachable with no error anywhere — the
 * failure `specs/071-modular-packaging/decisions.md` D-23 calls the worst
 * available, for the same reason. Raised while the module graph is being
 * flattened, which is before the router is built and therefore before anything
 * can render the wrong screen.
 */
export class DuplicateAdminRouteError extends Error {
  override readonly name = 'DuplicateAdminRouteError';
}

/** Every route the registry contributes, each carrying its owner. */
export function registryRoutes(
  entries: typeof MODULE_ADMIN_CONTRIBUTIONS = MODULE_ADMIN_CONTRIBUTIONS,
): readonly OwnedBy<AdminRouteDeclaration>[] {
  const byPath = new Map<string, string>();
  const routes: OwnedBy<AdminRouteDeclaration>[] = [];
  for (const entry of entries) {
    for (const route of entry.contributions.routes ?? []) {
      const claimed = byPath.get(route.path);
      if (claimed !== undefined) {
        throw new DuplicateAdminRouteError(
          `'${claimed}' and '${entry.moduleId}' both declare the admin route ` +
            `'${route.path}'. react-router takes the first match, so one of these screens ` +
            `would be unreachable with no error anywhere — one route path has one owner.`,
        );
      }
      byPath.set(route.path, entry.moduleId);
      routes.push({ ...route, module: entry.moduleId });
    }
  }
  return routes;
}

/**
 * Every nav entry the registry contributes for one section, ordered.
 *
 * `weight` first, then module id, so the order is a function of the
 * declarations and never of the order the generator happened to walk in.
 */
export function registryNavFor(
  section: string,
  entries: typeof MODULE_ADMIN_CONTRIBUTIONS = MODULE_ADMIN_CONTRIBUTIONS,
): readonly OwnedBy<AdminNavDeclaration>[] {
  const found: OwnedBy<AdminNavDeclaration>[] = [];
  for (const entry of entries) {
    for (const item of entry.contributions.nav ?? []) {
      if (item.section !== section) continue;
      found.push({ ...item, module: entry.moduleId });
    }
  }
  return found.sort(
    (left, right) =>
      left.weight - right.weight || left.module.localeCompare(right.module),
  );
}
