/**
 * Cross-module reaches still standing in `quote_requests` (feature 075,
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
  'admin/src/modules/quote_requests/RfqCreatePage.tsx:catalog/components/ProductPicker':
    'Admin surface reach: `quote_requests/RfqCreatePage.tsx` imports `ProductPicker` ' +
    'from `@/modules/catalog/components/ProductPicker`, which `catalog` owns.\n\n' +
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
  'admin/src/modules/quote_requests/RfqDetail.tsx:catalog/components/ProductPicker':
    'Admin surface reach: `quote_requests/RfqDetail.tsx` imports `ProductPicker` from ' +
    '`@/modules/catalog/components/ProductPicker`, which `catalog` owns.\n\n' +
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
  'admin/src/modules/quote_requests/RfqDetail.tsx:orders/Section':
    'Admin surface reach: `quote_requests/RfqDetail.tsx` imports `Section` from ' +
    '`@/modules/orders/Section`, which `orders` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: **not a zone**, and this entry said it was. The sentence it carried was ' +
    'written once by feature 091 Phase 0 and pasted across all 24 of its component ' +
    'reaches — the right thing to have done then, before anybody had read a signature, ' +
    'and a stale retiring condition by the time `admin-component-contribution.md` Z1 ' +
    'existed to decide the question mechanically. Nothing went red for it: the ratchet on ' +
    'this ledger is two-way on the **key**, never on the reason.\n\n' +
    'Z1 is the rule: a reach is a zone contribution when the *owner* decides that the ' +
    'component appears, and a published component when the *consumer* does. ' +
    '`Section` is `title`, `action`, `className` and `children` — a heading and a slot, ' +
    'with nothing of `orders` inside it. Z1 question 1 does not fire and question 2 does ' +
    'not either: this screen decides entirely where and whether the block appears, and ' +
    'names it five times. That is question 3, a published component.\n\n' +
    'Being a layout primitive rather than a composite, its home is ' +
    '`@endora-commerce/admin-kit/ui` and not `./components`. What retires it is that ' +
    'publication, with a re-export shim at the old path. Moving the file, or rewriting ' +
    'the specifier as `orders`\' package subpath, still retires nothing.',
  'admin/src/modules/quote_requests/RfqDetail.tsx:custom_fields/CustomFieldValuesPanel':
    'Admin surface reach: `quote_requests/RfqDetail.tsx` imports ' +
    '`CustomFieldValuesPanel` from `../custom_fields/CustomFieldValuesPanel`, which ' +
    '`custom_fields` owns.\n\n' +
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
};
