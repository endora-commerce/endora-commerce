/**
 * Cross-module reaches still standing in `meta_ads` (feature 075,
 * FR-022…FR-026; feature 091, FR-017).
 *
 * Keyed `<file>:<target module>/<target path>` for an import and
 * `<file>:sql:<owner>/<table>` for a raw statement or a query builder, so moving code
 * inside a file does not invalidate an entry. The file is spelled as `layout.keyOf`
 * spells it — repository-relative for an admin surface, which has no `backend/src` of
 * the application's to be relative to.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * **Every entry here is an admin surface reach**, recorded by feature 091 Phase 0 before
 * any admin directory moves into its module's package. What retires one is never the move
 * and never a rewritten specifier: it is the owner publishing what this consumer needs —
 * into `@endora-commerce/admin-kit` where the piece is generic, or as an admin
 * contribution zone where it is the owner's own screen (`spec.md` FR-006, FR-007).
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'admin/src/modules/meta_ads/pages/CustomEventMappingEditPage.tsx:sales_channels/api/sales-channels-client':
    'Admin surface reach: `meta_ads/pages/CustomEventMappingEditPage.tsx` imports ' +
    '`salesChannelsClient` from `@/modules/sales_channels/api/sales-channels-client`, ' +
    'which `sales_channels` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach is the **client module**, not the HTTP call — the request ' +
    'and response shapes are already in `@endora-commerce/contracts`, which both sides ' +
    'compile. The Phase 4 batch that moves this consumer\'s admin surface into its ' +
    'package has to take one of two exits rather than rewrite the specifier: the caller ' +
    'builds the request from the published `apiClient` and the contract\'s own types, or ' +
    'the owner publishes the client on a surface a stranger can name. A bare specifier ' +
    'into the owner\'s `./admin` subpath is neither — that subpath exports the ' +
    'contributions object and nothing else ' +
    '(`specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md` R2), so ' +
    'it cannot carry a client and a reach through it would still be counted here.',
  'admin/src/modules/meta_ads/pages/CustomEventMappingsListPage.tsx:sales_channels/api/sales-channels-client':
    'Admin surface reach: `meta_ads/pages/CustomEventMappingsListPage.tsx` imports ' +
    '`salesChannelsClient` from `@/modules/sales_channels/api/sales-channels-client`, ' +
    'which `sales_channels` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach is the **client module**, not the HTTP call — the request ' +
    'and response shapes are already in `@endora-commerce/contracts`, which both sides ' +
    'compile. The Phase 4 batch that moves this consumer\'s admin surface into its ' +
    'package has to take one of two exits rather than rewrite the specifier: the caller ' +
    'builds the request from the published `apiClient` and the contract\'s own types, or ' +
    'the owner publishes the client on a surface a stranger can name. A bare specifier ' +
    'into the owner\'s `./admin` subpath is neither — that subpath exports the ' +
    'contributions object and nothing else ' +
    '(`specs/091-module-owned-admin-surfaces/contracts/admin-contribution.md` R2), so ' +
    'it cannot carry a client and a reach through it would still be counted here.',
};
