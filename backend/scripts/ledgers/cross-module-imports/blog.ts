/**
 * Cross-module reaches still standing in `blog` (feature 075,
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
  'admin/src/modules/blog/pages/BlogCategoryEditor.tsx:cms/components/PageBuilderEditor':
    'Admin surface reach: `blog/pages/BlogCategoryEditor.tsx` imports ' +
    '`PageBuilderEditor` from `../../cms/components/PageBuilderEditor`, which `cms` owns.\n\n' +
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
    '`PageBuilderEditor` takes `data` and `onChange` — value in, value back — which is Z1 ' +
    'question 1 and settles that the **consumer** decides it appears. So it is a published ' +
    'component and not something the owner contributes.\n\n' +
    'Where it is published is a second question and is already answered elsewhere: the ' +
    'Puck editor family goes into D-192\'s `page-builder`-family package with the rest of ' +
    'the builder, not into the kit and not behind a zone. What retires this entry is that ' +
    'package existing and this screen naming it. Moving the file, or rewriting the ' +
    'specifier as `cms`\' own package subpath, still retires nothing.',
  'admin/src/modules/blog/pages/BlogPostEditor.tsx:cms/components/PageBuilderEditor':
    'Admin surface reach: `blog/pages/BlogPostEditor.tsx` imports `PageBuilderEditor` ' +
    'from `../../cms/components/PageBuilderEditor`, which `cms` owns.\n\n' +
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
    '`PageBuilderEditor` takes `data` and `onChange` — value in, value back — which is Z1 ' +
    'question 1 and settles that the **consumer** decides it appears. So it is a published ' +
    'component and not something the owner contributes.\n\n' +
    'Where it is published is a second question and is already answered elsewhere: the ' +
    'Puck editor family goes into D-192\'s `page-builder`-family package with the rest of ' +
    'the builder, not into the kit and not behind a zone. What retires this entry is that ' +
    'package existing and this screen naming it. Moving the file, or rewriting the ' +
    'specifier as `cms`\' own package subpath, still retires nothing.',
};
