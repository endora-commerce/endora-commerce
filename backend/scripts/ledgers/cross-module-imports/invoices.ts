/**
 * Cross-module reaches still standing in `invoices` (feature 075,
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
  'admin/src/modules/invoices/InvoiceDetail.tsx:ksef/components/InvoiceKsefPanel':
    'Admin surface reach: `invoices/InvoiceDetail.tsx` imports `InvoiceKsefPanel` from ' +
    '`@/modules/ksef/components/InvoiceKsefPanel`, which `ksef` owns.\n\n' +
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
  'admin/src/modules/invoices/templates/invoice-puck-config.tsx:cms/components/AssetPickers':
    'Admin surface reach: `invoices/templates/invoice-puck-config.tsx` imports ' +
    '`createImageAssetField`, `createImageSourceField`, `createImageUrlField` from ' +
    '`@/modules/cms/components/AssetPickers`, which `cms` owns.\n\n' +
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
  'admin/src/modules/invoices/templates/InvoiceTemplateEditor.tsx:cms/components/PageBuilderHeaderActions':
    'Admin surface reach: `invoices/templates/InvoiceTemplateEditor.tsx` imports ' +
    '`PageBuilderHeaderActions` from ' +
    '`@/modules/cms/components/PageBuilderHeaderActions`, which `cms` owns.\n\n' +
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
    '`PageBuilderHeaderActions` takes `fullscreen` / `onToggleFullscreen`, `currentData`, ' +
    '`onCopyFromLanguage`, `onClearCanvas` and its own translator `t`: every one of them a ' +
    'value handed in with a callback back, which is Z1 question 1. The **consumer** decides ' +
    'it appears, so it is a published component and not a contribution.\n\n' +
    'Its home is D-192\'s `page-builder`-family package, with `PageBuilderEditor` and the ' +
    'rest of the builder — not the kit and not a zone. What retires this entry is that ' +
    'package existing and this screen naming it. Moving the file, or rewriting the ' +
    'specifier as `cms`\' own package subpath, still retires nothing.',
  'admin/src/modules/invoices/templates/InvoiceTemplateEditor.tsx:cms/components/PageBuilderOverlayBridge':
    'Admin surface reach: `invoices/templates/InvoiceTemplateEditor.tsx` imports ' +
    '`PageBuilderOverlayBridge` from ' +
    '`@/modules/cms/components/PageBuilderOverlayBridge`, which `cms` owns.\n\n' +
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
    '`PageBuilderOverlayBridge` wraps `children` and is told `hover`, `isSelected`, ' +
    '`componentId` and `componentType`. Nothing is handed back, so Z1 question 1 does not ' +
    'fire — but question 2 does not either: the consumer positions it explicitly and ' +
    'supplies everything it renders from, which is question 3, a display wrapper the ' +
    'consumer places and does not control. Published component, not a zone.\n\n' +
    'It already imports `@endora-commerce/page-builder-core/editor`, so its home is ' +
    'D-192\'s `page-builder`-family package rather than the kit. What retires this entry ' +
    'is that package existing and this screen naming it. Moving the file, or rewriting the ' +
    'specifier as `cms`\' own package subpath, still retires nothing.',
};
