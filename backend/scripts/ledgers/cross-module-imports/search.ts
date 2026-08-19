/**
 * Cross-module imports still standing in `search` (feature 075, FR-022…FR-026).
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
  // The `search` cut merge request retired eleven of the fifteen: the indexer
  // and the suggestion enricher read `catalogProductReadPort` and
  // `organizationDetailsPort`, three files name `CatalogAttributeReadPort`, the
  // LLM toggle and its route name `SettingsAdminPort` /
  // `SettingsAdminAuditContext`, and `SYSTEM_ATTRIBUTE_SCOPES` comes from
  // `@b2b/contracts`, where Phase P relocated it.
  //
  // Five remain, all of them the same CLI entry point, and each says why
  // below. The four `sql` entries this shard carried are gone: the indexer's
  // `product_categories` / `categories` joins are `catalogCategoryReadPort`
  // and its two `sales_channel_products` statements are the kernel membership
  // accessor Principle XII reserves the bridge for.
  //
  // The `search:reindex` group is the
  // **shape** `_i18n` escalated one cut earlier and not an oversight of this
  // one: it is a module-owned CLI entry point, so it has no container and no
  // `ModuleContext`, nothing to resolve a port from, and it hand-builds the
  // provider's services instead. Every remedy available inside this module is
  // worse than the import — re-implementing `catalog`'s queries here is trap 6,
  // deleting a documented operational command to satisfy a static check is a
  // product decision rather than a refactor, and moving the script out of the
  // module changes the specifier and not the coupling (plan.md trap 1).
  //
  // Retired by: the same ruling `modules/_i18n/scripts/reload.ts` waits on —
  // how a module-owned CLI script obtains what a composition root supplies.
  // Either such a script composes the container the way a root does, or module
  // CLI entry points move to the deployment and stop being module files at all.
  'modules/search/scripts/reindex.ts:catalog/services/catalog-attribute-read.service':
    'F3 Phase C — search, escalated. A module-owned CLI entry point has no container to ' +
    'resolve a port from, so it builds the provider service by hand. Retired by the ruling ' +
    'on how a module CLI script reaches one — see the note above and _i18n.ts.',
  'modules/search/scripts/reindex.ts:custom_fields/services/custom-field-definition.service':
    'F3 Phase C — search, escalated. Same CLI entry point, same missing container: the ' +
    'definition source `CatalogAttributeReadService` needs is built by hand here. Retired ' +
    'by the ruling on how a module CLI script reaches a composition-root input.',
  'modules/search/scripts/reindex.ts:custom_fields/services/custom-field-definitions-cache':
    'F3 Phase C — search, escalated. Same CLI entry point, same missing container: the ' +
    'definition cache the source takes is built by hand here. Retired by the ruling on how ' +
    'a module CLI script reaches a composition-root input.',
  // The fourth entry of the same site is new, and it is the escalation's cost
  // rather than a new coupling: the indexer's product rows became
  // `catalogProductReadPort` in this merge request, and the one caller with no
  // container to resolve it from has to construct the implementation. The
  // alternative was re-implementing `catalog`'s query inside this script, which
  // is plan.md trap 6 — a coupling no check in the tree can see.
  'modules/search/scripts/reindex.ts:catalog/services/catalog-product-read.service':
    'F3 Phase C — search, escalated. Same CLI entry point, same missing container: the ' +
    'product read port the indexer now takes is built by hand here. Retired by the ruling ' +
    'on how a module CLI script reaches a composition-root input.',
  // The fifth is the same cost paid a second time, for the same reason and by
  // the same merge request that removed this shard's four `sql` entries: the
  // indexer's category reads became `catalogCategoryReadPort`, and this script
  // is still the one caller with nothing to resolve it from. It is one import
  // traded for four raw statements that crossed the boundary invisibly — and
  // an import is at least a specifier a check can see.
  //
  // Its kernel sibling costs nothing here: the membership accessor the same
  // change introduced is `src/kernel` code, which a module may name.
  'modules/search/scripts/reindex.ts:catalog/services/catalog-category-read.service':
    'F3 Phase C — search, escalated. Same CLI entry point, same missing container: the ' +
    'category read port the indexer now takes is built by hand here. Retired by the ruling ' +
    'on how a module CLI script reaches a composition-root input.',
};
