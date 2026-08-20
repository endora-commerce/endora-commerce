/**
 * Cross-module imports still standing in `_i18n` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  // The `_i18n` cut merge request retired the other three: the two
  // `AdminUserService` sites became `adminUserPreferencePort`, and the
  // `LoadedManifestRegistry` type became the structural view this module
  // actually reads. This one is left standing deliberately, with the question
  // that retires it, because it is a **shape** rather than an oversight.
  //
  // `i18n:reload` is a module-owned CLI entry point, so it has no container and
  // no `ModuleContext` — there is nothing to resolve a port from — and what it
  // needs is the deployment's module registry, which is a composition-root
  // input by nature (it is why `resolvedModuleRegistry` and
  // `lifecycleManifestRegistry` are root-supplied names rather than ports).
  // Every remedy available inside this module is worse than the import: moving
  // the script out of the module it belongs to changes the specifier and not
  // the coupling (plan.md trap 1), re-deriving the module list from the
  // filesystem is a second discovery nothing in the tree can see (trap 6), and
  // deleting a working operational command to satisfy a static check is a
  // product decision, not a refactor.
  //
  // `search/scripts/reindex.ts` (3 entries) and
  // `admin_users/scripts/create-admin.ts` (2) are the same shape, which is what
  // makes it worth deciding once rather than three times.
  //
  // Retired by: the ruling on how a module-owned CLI script obtains a
  // composition-root input. Either such a script composes the container the way
  // a root does, or module CLI entry points move to the deployment and stop
  // being module files at all.
  'modules/_i18n/scripts/reload.ts:_lifecycle/registered-manifests':
    'F3 Phase C — _i18n, escalated. A module-owned CLI entry point has no container to ' +
    'resolve a port from, and the module registry it needs is a composition-root input. ' +
    'Retired by the ruling on how a module CLI script reaches one — see the note above.',
};
