/**
 * Cross-module reaches still standing in `returns` (feature 075,
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
  'admin/src/modules/returns/ReturnsList.tsx:orders/orderStatusColor':
    'Admin surface reach: `returns/ReturnsList.tsx` imports `orderStatusBadgeStyle` ' +
    'from `@/modules/orders/orderStatusColor`, which `orders` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moves**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There are 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    'Retired by: the reach is a **helper** rather than a screen: a pure function or a ' +
    'small module of the owner\'s that this consumer re-uses. What retires it is ' +
    'whichever of two answers its owner takes — the helper is generic and moves into ' +
    'the kit (`admin-kit-surface.md` R5), or it encodes the owner\'s domain and this ' +
    'consumer asks for the rendered result through a zone contribution (FR-007) instead ' +
    'of recomputing it.',
  'admin/src/modules/returns/ReturnStatusesConfigPage.tsx:orders/StatusTransitionGraph':
    'Admin surface reach: `returns/ReturnStatusesConfigPage.tsx` imports ' +
    '`StatusTransitionGraph` from `@/modules/orders/StatusTransitionGraph`, which ' +
    '`orders` owns.\n\n' +
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
    '`StatusTransitionGraph` takes `statuses`, `transitions`, `statusLabel`, `onAdd`, ' +
    '`onRemove` and `t` — data in, callbacks out, and its own translator — with zero ' +
    '`orders` knowledge left inside it. Z1 question 1, so a published component.\n\n' +
    'What retires it is publication in `@endora-commerce/admin-kit` on `./components`, ' +
    'with a re-export shim at the old path. The `t` prop is what R6\'s extension of ' +
    '2026-08-31 permits and is not an obstacle to it: a kit component may receive ' +
    'behaviour from the caller that **owns** the thing behind it, and here `returns` owns ' +
    'the status vocabulary being labelled. Moving the file, or rewriting the specifier as ' +
    '`orders`\' package subpath, still retires nothing.',
};
