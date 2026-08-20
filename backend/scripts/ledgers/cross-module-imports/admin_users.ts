/**
 * Cross-module imports still standing in `admin_users` (feature 075, FR-022…FR-026).
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
  // The `admin_users` cut merge request retired the other twenty-one. This one
  // is left standing deliberately, and it is the shape `_i18n`'s shard already
  // escalated — that note names this very file, and says the question is worth
  // deciding once rather than three times.
  //
  // `admin:create` is the bootstrap CLI that mints the first administrator. It
  // has no container and no `ModuleContext`, so there is nothing to resolve
  // `adminRolePort` from: `abandonment-sweep.ts`'s header records why composing
  // one in a one-shot script is refused, and every `module:*` script builds its
  // services by hand for the same reason. What it needs — resolve the
  // `platform_admin` role, creating it when a fresh database has none — is
  // exactly `AdminRolePort.findByCode` + `upsertByCode`, which `admin_roles`
  // already publishes; the port is unreachable, not unpublished.
  //
  // Every remedy available inside this module is worse than the import:
  // inlining a query against `admin_roles`' table is two modules writing one
  // table and invisible to every check in the tree (plan.md trap 6), moving the
  // script out of the module it belongs to changes the specifier and not the
  // coupling (trap 1), and deleting the only way to create the first
  // administrator is a product decision rather than a refactor.
  //
  // The `hashPassword` half of this file's pair was cut with the rest: it moved
  // to `src/kernel/crypto/` in Phase P precisely because it answers the same
  // whether `auth` is present or not (FR-013, R-09).
  //
  // Retired by: the ruling on how a module-owned CLI script obtains a
  // collaborator it cannot resolve — the same ruling `_i18n`'s shard and
  // `search/scripts/reindex.ts` wait on.
  'modules/admin_users/scripts/create-admin.ts:admin_roles/entities/admin-role.entity':
    'F3 Phase C — admin_users, escalated. A module-owned CLI entry point has no container to ' +
    'resolve `adminRolePort` from, and the bootstrap it performs is the one write that must ' +
    'work on a database with no administrator in it. Retired by the ruling on how a module ' +
    'CLI script reaches a port — see the note above.',
};
