/**
 * The seam that carries the admin's module registry into the kit (feature 091,
 * P4a; Z6).
 *
 * The renderer is the kit's and not the admin application's, because a **host**
 * screen becomes a package: `catalog` hosts three zones and moves into
 * `packages/modules/catalog`, at which point `admin/src/lib/module-registry` is
 * unreachable to it. Routes and nav have no such problem — their one consumer
 * each is the application itself, for ever — which is why `registryRoutes()`
 * and `registryNavFor()` stay where they are and there is no
 * `registryZonesFor()` beside them.
 *
 * The registry itself stays the application's: it *is* module knowledge, and
 * `admin-kit-surface.md` R6 refuses module knowledge in the kit. So the kit
 * publishes a provider and holds no list — the entries arrive as a prop, from
 * the one place that has them.
 *
 * **Nothing here filters.** An operator's activation flip must take effect
 * without a rebuild (Principle XVII item 5, D-67/D-68 pointed at the frontend),
 * so presence is decided at enumeration in {@link useAdminZone} and never in
 * the registry or in this provider. The provider answers *"what could be
 * here"*.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AdminZoneContribution } from '@endora-commerce/contracts';

/**
 * One module's zone contributions, keyed by the module that shipped them.
 *
 * The module id is the **entry's key** and never a field of a contribution
 * (D-142): an attribution a module can write is an attribution a module can get
 * wrong, and here getting it wrong would mean contributing under another
 * module's presence.
 */
export interface AdminZoneRegistryEntry {
  readonly moduleId: string;
  readonly zones: readonly AdminZoneContribution[];
}

/** A contribution with the module that shipped it. */
export interface OwnedZoneContribution extends AdminZoneContribution {
  readonly module: string;
}

/**
 * Flattened contributions, in declaration order.
 *
 * `null` is the "no provider mounted" state and is distinct from "the provider
 * is mounted and every module contributes nothing": {@link useAdminZone} refuses
 * the first and returns an empty list for the second, because a host screen
 * rendering a zone outside the provider is a wiring defect and reporting it as
 * *"nobody contributed"* is the silent answer this estate refuses everywhere
 * else.
 */
const AdminContributionsContext = createContext<readonly OwnedZoneContribution[] | null>(null);

/** Raised when a zone is rendered outside {@link AdminContributionsProvider}. */
export class AdminContributionsUnavailableError extends Error {
  override readonly name = 'AdminContributionsUnavailableError';
}

export interface AdminContributionsProviderProps {
  /**
   * The generated registry — `MODULE_ADMIN_CONTRIBUTIONS`, whose entries carry
   * a whole `AdminContributions` each.
   *
   * Typed structurally over the one field this provider reads, so the admin can
   * hand its registry straight in and a test can hand in two lines.
   */
  readonly entries: readonly {
    readonly moduleId: string;
    readonly contributions: { readonly zones?: readonly AdminZoneContribution[] };
  }[];
  readonly children: ReactNode;
}

/** Mounted once by the admin application, with its generated registry. */
export function AdminContributionsProvider({
  entries,
  children,
}: AdminContributionsProviderProps): ReactNode {
  const flattened = useMemo(
    (): readonly OwnedZoneContribution[] =>
      entries.flatMap((entry) =>
        (entry.contributions.zones ?? []).map(
          (zone): OwnedZoneContribution => ({ ...zone, module: entry.moduleId }),
        ),
      ),
    [entries],
  );
  return (
    <AdminContributionsContext.Provider value={flattened}>
      {children}
    </AdminContributionsContext.Provider>
  );
}

/**
 * Every contribution the provider carries, unfiltered and unordered.
 *
 * Internal to the `./zones` subpath: the filtering and the ordering are
 * {@link useAdminZone}'s, and a second consumer of the raw list is a second
 * place the presence rule could be forgotten.
 */
export function useAdminContributions(): readonly OwnedZoneContribution[] {
  const value = useContext(AdminContributionsContext);
  if (value === null) {
    throw new AdminContributionsUnavailableError(
      'A zone was rendered outside <AdminContributionsProvider>. The admin application ' +
        'mounts it once, with MODULE_ADMIN_CONTRIBUTIONS; a test rendering a host screen ' +
        'mounts it with the contributions under assertion. Reporting "nobody contributed" ' +
        'here would make a wiring defect indistinguishable from an empty registry.',
    );
  }
  return value;
}
