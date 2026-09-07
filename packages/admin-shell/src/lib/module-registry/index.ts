/**
 * The generated admin registry, flattened into what the two host surfaces
 * render (feature 091, Phase 2).
 *
 * The generated registry is a list of module contribution sets; `App.tsx`
 * needs routes and `AppShell.tsx` needs nav entries, each carrying the **owner**
 * so the one visibility predicate can filter on it. Attribution is added here
 * rather than declared by the module, for D-142's reason: the registry entry's
 * key is the module id, so a declaration cannot claim to belong to a module
 * other than the one that shipped it.
 *
 * **The registry itself is the application's and arrives as a value** (feature
 * 110, T120). This file is `@endora-commerce/admin-shell`'s and the generated
 * artefact is the admin project's — `admin/src/modules.generated.ts` here, an
 * instance's own `src/modules.generated.ts` there — so the shell cannot import
 * it and does not try. It is handed to `<App contributions={…}/>`, carried to
 * `AppShell` by {@link AdminRegistryProvider}, and every function below takes it
 * as an argument. That is the seam D-207 requires of the backend applied to the
 * frontend: which modules exist is a fact about the instance, and the shell is
 * the same file in every one of them.
 *
 * **Nothing here filters.** `isSurfaceVisible` decides presence and permission
 * at render, because an operator's activation flip must take effect without a
 * rebuild (Principle XVII item 5, and D-67/D-68's boot-hook case pointed at the
 * frontend). The registry answers *"what could be here"*; the predicate answers
 * *"what is here for this operator right now"*.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type {
  AdminContributions,
  AdminNavDeclaration,
  AdminRouteDeclaration,
} from '@endora-commerce/admin-kit/contributions';

/**
 * One module's contribution set, keyed by the module id that shipped it.
 *
 * The generated artefact declares this shape too, and that is not a duplicate
 * waiting to disagree: both spellings name the kit's `AdminContributions`, so
 * TypeScript's structural identity makes them one type and a change to the
 * kit's declaration reaches both in the same compile. It is **not** moved into
 * the kit, which is where a nominal single home would go, because
 * `admin-kit-surface.md` R6 refuses module knowledge there — the registry is
 * exactly that, which is why it stays the application's (`App.tsx`'s own note
 * on the provider seam).
 */
export interface AdminRegistryEntry {
  readonly moduleId: string;
  readonly contributions: AdminContributions;
}

/** Raised when a shell surface reads the registry outside its provider. */
export class AdminRegistryUnavailableError extends Error {
  override readonly name = 'AdminRegistryUnavailableError';
}

/**
 * `null` is *"no provider mounted"* and is distinct from *"mounted, and the
 * instance installed no module"*, on `useAdminZone`'s reasoning one seam over:
 * a shell surface reading the registry with no provider above it is a wiring
 * defect, and answering it *"nobody contributed"* would make an empty sidebar
 * indistinguishable from a broken mount.
 */
const AdminRegistryContext = createContext<readonly AdminRegistryEntry[] | null>(null);

export interface AdminRegistryProviderProps {
  readonly entries: readonly AdminRegistryEntry[];
  readonly children: ReactNode;
}

/** Carries the application's generated registry into the shell's surfaces. */
export function AdminRegistryProvider({
  entries,
  children,
}: AdminRegistryProviderProps): ReactNode {
  return createElement(AdminRegistryContext.Provider, { value: entries }, children);
}

/** The registry the application handed in. Throws outside the provider. */
export function useAdminRegistry(): readonly AdminRegistryEntry[] {
  const entries = useContext(AdminRegistryContext);
  if (entries === null) {
    throw new AdminRegistryUnavailableError(
      'the admin registry was read outside AdminRegistryProvider. The generated contribution ' +
        'registry is the admin project\'s and reaches the shell as `<App contributions={…}/>`; ' +
        'a surface reading it with no provider above it would render an empty sidebar that ' +
        'looks exactly like an instance with no modules installed.',
    );
  }
  return entries;
}

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
  entries: readonly AdminRegistryEntry[],
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
  entries: readonly AdminRegistryEntry[],
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
