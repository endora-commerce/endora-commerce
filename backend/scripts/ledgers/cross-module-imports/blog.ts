/**
 * Cross-module reaches still standing in `blog` (feature 075,
 * FR-022…FR-026; feature 091, FR-017).
 *
 * Keyed `<file>:<target module>/<target path>` for an import and
 * `<file>:sql:<owner>/<table>` for a raw statement or a query builder, so moving code
 * inside a file does not invalidate an entry. The file is spelled as `layout.keyOf`
 * spells it — repository-relative, which for this module's admin surface meant
 * `admin/src/…` until feature 091's batch 16 and `packages/modules/blog/src/…` since.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * **Both entries here are admin surface reaches**, recorded by feature 091 Phase 0 before
 * any admin directory moved into its module's package. What retires one is never the move
 * and never a rewritten specifier: it is the owner publishing what this consumer needs —
 * into `@endora-commerce/admin-kit` where the piece is generic, as an admin contribution
 * zone where it is the owner's own screen, or on the owner's `./admin-ui` where it is a
 * component whose rendering is the owner's domain (`spec.md` FR-006, FR-007; D-191).
 *
 * **This shard opened with two keys and still holds two, and each pair is the same
 * coupling under a different spelling** (feature 091, batch 16). That is `settings`' shape
 * from batch 10, arriving in the batch that moves *both* endpoints at once, so it is worth
 * stating rather than leaving a reader to infer it from a diff: publication gave the reach
 * a supported name and did not remove it, and the retiring condition each entry already
 * carried is unchanged.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/blog/src/admin/pages/BlogCategoryEditor.tsx:cms/admin-ui':
    'Admin surface reach: `blog/admin/pages/BlogCategoryEditor.tsx` imports ' +
    '`PageBuilderEditor` from `@endora-commerce/mod-cms/admin-ui`, which `cms` owns.\n\n' +
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
    'Where it is published is a second question, and batch 16 — which moves **both** ' +
    'endpoints — answered the near half of it: `cms` publishes the component on its own ' +
    '`./admin-ui`, which is D-191\'s exit and `credentials`\' from batch 10. The kit ' +
    'refuses it on R7 (it is a `@measured/puck` host, and the kit is what all 66 module ' +
    'packages compile against) and `@endora-commerce/page-builder-admin` refuses it on ' +
    'ownership: that package holds the files naming `cms` **nowhere**, and this one calls ' +
    '`cmsClient`, reads `useTranslation(\'cms\')` and lays the CMS page container out.\n\n' +
    '**So this entry is re-keyed and not retired, exactly as it said it would be.** Z11 ' +
    'keeps a published-component reach counted: the designation is derived from the ' +
    'artefact — a subpath is contract surface iff its emitted module exports no runtime ' +
    'binding — and `dist/admin-ui/index.js` exports a React component. What retires it is ' +
    'unchanged and is not batch 16\'s: D-192\'s `page-builder` family growing a home for ' +
    'the whole builder, and this screen naming it there.',
  'packages/modules/blog/src/admin/pages/BlogPostEditor.tsx:cms/admin-ui':
    'Admin surface reach: `blog/admin/pages/BlogPostEditor.tsx` imports `PageBuilderEditor` ' +
    'from `@endora-commerce/mod-cms/admin-ui`, which `cms` owns.\n\n' +
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
    'Where it is published is a second question, and batch 16 — which moves **both** ' +
    'endpoints — answered the near half of it: `cms` publishes the component on its own ' +
    '`./admin-ui`, which is D-191\'s exit and `credentials`\' from batch 10. The kit ' +
    'refuses it on R7 (it is a `@measured/puck` host, and the kit is what all 66 module ' +
    'packages compile against) and `@endora-commerce/page-builder-admin` refuses it on ' +
    'ownership: that package holds the files naming `cms` **nowhere**, and this one calls ' +
    '`cmsClient`, reads `useTranslation(\'cms\')` and lays the CMS page container out.\n\n' +
    '**So this entry is re-keyed and not retired, exactly as it said it would be.** Z11 ' +
    'keeps a published-component reach counted: the designation is derived from the ' +
    'artefact — a subpath is contract surface iff its emitted module exports no runtime ' +
    'binding — and `dist/admin-ui/index.js` exports a React component. What retires it is ' +
    'unchanged and is not batch 16\'s: D-192\'s `page-builder` family growing a home for ' +
    'the whole builder, and this screen naming it there.',
};
