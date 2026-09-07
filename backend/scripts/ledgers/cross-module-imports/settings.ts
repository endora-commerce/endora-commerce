/**
 * Cross-module reaches still standing in `settings` (feature 075,
 * FR-022…FR-026; feature 091, FR-017).
 *
 * Keyed `<file>:<target module>/<target path>` for an import and
 * `<file>:sql:<owner>/<table>` for a raw statement or a query builder, so moving code
 * inside a file does not invalidate an entry. The file is spelled as `layout.keyOf`
 * spells it — repository-relative, which for this module's admin surface meant
 * `admin/src/…` until feature 091's batch 10 and `packages/modules/settings/src/…`
 * since.
 *
 * Two-way: an unledgered reach fails the build, and an entry that no longer describes one
 * fails it too. Delete this file when the last entry goes; an empty shard is refused,
 * because a done signal that says nothing is not one.
 *
 * **The one entry here is an admin surface reach**, recorded by feature 091 Phase 0
 * before any admin directory moved into its module's package. What retires such an
 * entry is never the move and never a rewritten specifier: it is the owner publishing
 * what this consumer needs — into `@endora-commerce/admin-kit` where the piece is
 * generic, as an admin contribution zone where it is the owner's own screen, or on the
 * owner's `./admin-ui` where it is a component whose rendering is the owner's domain
 * (`spec.md` FR-006, FR-007; D-191).
 *
 * **This shard opened with one key and still holds one, and the two are the same
 * coupling under a different spelling.** That is the whole of what D-191 settled, so it
 * is worth stating rather than leaving a reader to infer it from a diff: publication
 * gave the reach a supported name and did not remove it.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx:credentials/admin-ui':
    'Admin surface reach: `settings/admin/components/ConfigurationReferenceInput.tsx` ' +
    'imports `ConfigurationPreviewModal` from ' +
    '`@endora-commerce/mod-credentials/admin-ui`, which `credentials` owns.\n\n' +
    'Recorded by feature 091 Phase 0, **before any admin directory moved**, and that ' +
    'ordering is the entry\'s whole reason for existing rather than a note about it. ' +
    '`specs/084-small-f4-package-layout/contracts/module-package-layout.md` §0 measured ' +
    'the backend precedent: rewriting a ledgered relative import as a package specifier ' +
    '*deleted* the reach from the walk, whereupon the two-way ledger reported the entry ' +
    'describing it as stale and asked the author to remove the record of a debt nobody ' +
    'had paid. There were 72 of these, and every one would have gone that way, one ' +
    'directory at a time, in the direction that looks like progress.\n\n' +
    '**Not a zone.** `admin-component-contribution.md` Z1 decides the exit from the ' +
    'signature rather than from taste: `ConfigurationPreviewModal` takes `open`, ' +
    '`configuration` and `onClose`, so this screen decides that it appears — Z1 ' +
    'question 1, a published component. A zone has zero-or-many contributors and there ' +
    'is no honest answer for a modal that resolved to two `onClose`s.\n\n' +
    '**Not the kit either, and it is the one reach in this repository that is not.** ' +
    'The modal calls `useTranslation(\'credentials\')`, and R-1 §9.2 ruled that a ' +
    'module\'s translation namespace is module knowledge — `admin-kit-surface.md` R6 ' +
    'refuses it in as many words. Every string it renders is this owner\'s vocabulary, ' +
    'so the R-1 remedy that retired `AssetPicker`, `AssetUploader` and ' +
    '`CategoryTreePicker` — move the copy to `core`, publish into the kit — would put ' +
    'credential vocabulary in the shared bundle.\n\n' +
    '**So the exit was D-191\'s `./admin-ui`, taken in batch 10, and this key is ' +
    're-keyed rather than removed.** Z11 keeps a published-component reach counted: the ' +
    'designation `check:module-boundary` applies is derived from the artefact — a ' +
    'subpath is contract surface iff its emitted module exports no runtime binding — ' +
    'and `dist/admin-ui/index.js` exports a React component. It is a real coupling under ' +
    'a supported name rather than a coupling removed, which is the one place feature ' +
    "091's *\"0 remaining\"* has to be read as *\"0 remaining that a publication " +
    'retires"*.\n\n' +
    '**What retires it** is therefore not a publication at all: it is the setting value ' +
    'type. `credential_ref` is `credentials`\' concept rendered inside a `settings` ' +
    'field, and the seam that removes the reach is a contribution point for the *field ' +
    'editor* — `settings` naming a place and `credentials` contributing the whole ' +
    'control, picker and preview together — which is FR-007\'s mechanism applied to a ' +
    'form field and is what Z1 question 1 refuses today, because a zone cannot carry a ' +
    '`value`/`onChange` pair. Reopening that needs a single-contributor zone shape and ' +
    'an owner ruling. Until then the coupling stands here, gated at the render by ' +
    '`useSurfaceVisibility` (Z12) so an operator who switches `credentials` off loses ' +
    'the preview button and keeps the field, its stored value and the picker.',
};
