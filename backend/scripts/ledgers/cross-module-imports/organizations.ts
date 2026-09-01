/**
 * Cross-module reaches still standing in `organizations` (feature 075,
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
  'admin/src/modules/organizations/OrganizationDetail.tsx:quick_order/DefaultPreferencesPanel':
    'Admin surface reach: `organizations/OrganizationDetail.tsx` imports ' +
    '`DefaultPreferencesPanel` from `../quick_order/DefaultPreferencesPanel`, which ' +
    '`quick_order` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/organizations/OrganizationDetail.tsx:sales_channels/components/EntityChannelMembership':
    'Admin surface reach: `organizations/OrganizationDetail.tsx` imports ' +
    '`EntityChannelMembership` from ' +
    '`../sales_channels/components/EntityChannelMembership`, which `sales_channels` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/organizations/OrganizationDetail.tsx:price_lists/DisplayModeOverrideRow':
    'Admin surface reach: `organizations/OrganizationDetail.tsx` imports ' +
    '`DisplayModeOverrideRow` from `../price_lists/DisplayModeOverrideRow`, which ' +
    '`price_lists` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach mounts the owner\'s own screen fragment inside this module\'s ' +
    'screen, which is the case FR-007 exists for. What retires it is the owner ' +
    'declaring an **admin contribution zone**: the host screen publishes the zone name ' +
    'and the owner contributes into it, so the dependency reverses and neither module ' +
    'names the other. Moving the file, or rewriting the specifier as the owner\'s ' +
    'package subpath, retires nothing — it is the same coupling under a supported name, ' +
    'which is what recording this entry before the move exists to prevent.',
  'admin/src/modules/organizations/panels/FulfilmentStrategyPanel.tsx:inventory/components/FulfilmentStrategyPicker':
    'Admin surface reach: `organizations/panels/FulfilmentStrategyPanel.tsx` imports ' +
    '`FulfilmentStrategyPicker`, `FulfilmentStrategyValue`, `FulfilmentWarehouseOption` ' +
    'from `@/modules/inventory/components/FulfilmentStrategyPicker`, which `inventory` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach is a **generic picker**: it renders a chooser over data the ' +
    'owner holds and knows nothing about this consumer. What retires it is the ' +
    'component moving into the admin\'s own shared components and the kit publishing it ' +
    'on `@endora-commerce/admin-kit/components` in the same merge request — the order ' +
    '`specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` R5 states, ' +
    'so the kit never holds a component the admin application does not use. Six pickers ' +
    'are already published there and this one is not, which is the whole of the debt.',
};
