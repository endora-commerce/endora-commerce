/**
 * The module ids this repository writes as **string literals** in files the
 * module does not own — `check:admin-zones`' sixth finding (feature 091, P4a;
 * `contracts/admin-component-contribution.md` §5.1 as §9.3 widened it).
 *
 * ## Why a ledger at all, in a feature that is trying to empty them
 *
 * The predicate is red on nine sites the day it lands, and every one of them
 * is a coupling this feature converts rather than a defect to repair in this
 * merge request. The alternative to a ledger is not "no ledger" — it is not
 * shipping the predicate, and the predicate is the only instrument in this
 * estate that reads a module id out of a string.
 * `check:module-boundary` reads import specifiers and a string names none;
 * `check:admin-surface`'s subject is kit symbols; `i18n:hardcoded` reads
 * literals and not scopes. `CategoryTreePicker` shipped for a whole phase
 * rendering out of the `catalog` namespace and was found by a human reading an
 * unrelated diff.
 *
 * **It empties inside this feature**, which is what makes it worth its weight:
 * the four `visibility-gate` entries retire when their screens become zone
 * mounts, the one `kit-namespace` entry when the kit's strings move to `core`
 * under R-1's §9.2 ruling, and the four `module-namespace` entries as the
 * couplings they record are repaired. An entry that ever reads *"this is
 * fine"* means the predicate has outgrown its population — narrow it, never
 * add the entry.
 *
 * **A `module-namespace` entry whose screen is about to move used to be the case
 * to be careful with**, and batch 10 met it. This check's population was
 * `admin/src/modules/**` and the admin-ui family, so a screen moving into its
 * module's package took every finding about it out of the walk — the entry then
 * read stale and the ratchet asked for it to be removed, whether or not anybody
 * repaired anything. *"The file left the walk"* and *"the coupling went"*
 * produced the identical diff, so the rule for a batch author was: repair the
 * coupling **in the same merge request**, and say in the removal which of the
 * two happened.
 *
 * **That hazard is closed, and it was closed because it had stopped being an
 * incident and become a structure.** The walk now reads a module's own sources
 * too — every root `lib/module-roots.ts` derives, which reaches a module
 * package's `src/admin/` — so a screen moving into its package carries its
 * findings with it under a new key instead of vanishing. The rule above survives
 * as good practice and no longer rests on anyone remembering it. What made it
 * urgent rather than tidy: 37 of the module packages already ship an admin
 * layer, six batches of Story 3 will move sixteen more owners, and every one of
 * them widened a population no instrument in this estate was reading. The first
 * entry below is what it found — a gate added *by* batch 10, in the very merge
 * request whose file moved, correct and unwatched from the day it landed.
 *
 * **A `module-namespace` entry has a second retiring shape, and the first one
 * took it.** P5a moved the shared page-builder chrome's 33 `pageBuilder.*` keys
 * into `core` and pointed all three of its callers at `useTranslation('core')`,
 * so `InvoiceTemplateEditor` stopped naming `cms` without moving anywhere: the
 * copy the screen renders was never `cms`' knowledge, so the repair is a bundle
 * move rather than a screen move. That is R-1's §9.2 remedy applied one surface
 * over from the kit, and it is worth stating because the entry's own reason
 * predicted the screen move — the coupling went first, and the ratchet is what
 * said so.
 *
 * **It has already drained once, and the drain was found by the ratchet rather
 * than by anyone remembering.** This ledger opened with eleven entries, of
 * which two were `AssetPicker` and `AssetUploader` naming `assets_library`.
 * !1230 landed R-1's §9.2 repair for both while this branch was open; merging
 * `master` in reported them as stale in the same run, which is the property a
 * two-way ledger is for and the one a one-way baseline does not have.
 *
 * ## The key, and the count
 *
 * `<file>:<population>:<module id>`, and never a line number: a line-keyed
 * entry reds on any insertion above the site, which is a ratchet failing for a
 * reason that has nothing to do with its subject. The granularity that costs —
 * two sites of one population naming the same module in one file — is what
 * `sites` answers, in `check:module-boundary`'s own shape (issue #267). A plain
 * string means one site; both directions fail, a count below the walk being the
 * coupling nobody was asked about and one above it the entry that outlived its
 * site.
 *
 * ## What is **not** here, and the site that used to be the worked example
 *
 * §9.3 measured five `module-namespace` sites and the walk found four. The
 * fifth was `admin/src/modules/_shared/email-builder/EmailEditorPane.tsx`'s
 * `useTranslation('cms')`, out of the population by the attribution rule §5.1
 * names as an argument *against* the finding: ownership comes from the route
 * table and the nav, `_shared` is claimed by neither, and a file no nav entry
 * claims is the admin application's own. Judging it would have filed a reach
 * under a module that does not own it, which is the fail-closed direction.
 *
 * **That site is gone** — P5a pointed the pane at `core` with the two callers
 * that were in the population — so the exclusion now has no instance. It is
 * kept rather than deleted because the *rule* is unchanged and the next
 * `_shared` file will meet it: a file no nav entry claims is judged as nobody's,
 * and where `_shared` goes stays an owner decision (`plan.md` § *Phase 4* P5)
 * that a ledger cannot answer. The pane's own repair is the evidence for the
 * other half of §9.3's argument: nothing in this estate reported it, because a
 * site outside the population is a site outside every instrument.
 *
 * **And the rule has an answer for where `_shared` is going, which P5c put in
 * place before the move.** The exclusion above rests on ownership coming from
 * the route table and the nav, which is a fact about the admin *application*.
 * Once these files are `@endora-commerce/page-builder-admin`'s there is no nav
 * to consult and no route table to be absent from: a package declaring
 * `endora: { type: 'admin-ui' }` owns **no** module id, so every registered id
 * its sources name is another module's and is judged rather than excluded, with
 * a computed one refused on the kit's own reasoning. So the two answers do not
 * conflict — `_shared` under `admin/src` is the application's and is nobody's;
 * the same files in a package are nobody's and are therefore foreign to every
 * module. What decides which is where the file lives, and the instrument was
 * taught both before either was true, which is the whole of P5c.
 */

/** One recorded coupling: a reason, and — where the key covers more than one site — a count. */
export type ForeignModuleIdEntry = string | { readonly sites: number; readonly reason: string };

export type ForeignModuleIdLedger = Readonly<Record<string, ForeignModuleIdEntry>>;

export const FOREIGN_MODULE_IDS: ForeignModuleIdLedger = {
  // --- population 1: a visibility gate naming another module -----------------
  //
  // Both are correctly gated on both axes and both are FR-007's case: the host
  // names the owner because there is no place for the owner to contribute to.
  // Each retires into a zone contribution, and the enum member it needs arrives
  // with the batch that renders it.
  //
  // **Two of the four are gone**, and they are the worked example rather than a
  // note about one. `delivery_methods`' integrations card held a hard-coded
  // `dhl_parcel` block and a hard-coded `inpost` block; feature 091's batch 8
  // published `delivery_method.list.integrations`, the host renders it, and each
  // carrier declares a contribution of its own. The presence gate, the
  // permission gate and the ordering are the zone renderer's now, so a third
  // carrier needs no edit to a file its author does not own — which is the whole
  // of what FR-007 asks for.
  'admin/src/modules/orders/OrderDetail.tsx:visibility-gate:payments':
    "The payments tab button is rendered here, in the file's own words, so the gate is here " +
    'too. Retires at batch 10, when `orders` renders `order.detail.tabs` and `payments` ' +
    'contributes the tab.',
  'admin/src/modules/orders/OrderShipmentsTab.tsx:visibility-gate:inpost':
    'The InPost label button, and the reach `068-inpost-shipping` made by editing this file ' +
    '— the one FR-007 cites by name. Retires at batch 10 into `order.shipment.row.actions`, ' +
    "a repeated parameterised zone whose props carry the row's `deliveryMethodCode`, with " +
    '`dhl_parcel` as its second contributor.',
  // The third entry is the one the widened walk found, and it is a **correct**
  // gate rather than a defect — which is why it is recorded here rather than
  // repaired. Z12 added it in batch 10, in the same merge request that moved
  // this file into `@endora-commerce/mod-settings`, and it left the walk in the
  // act of being written.
  'packages/modules/settings/src/admin/components/ConfigurationReferenceInput.tsx:visibility-gate:credentials':
    '`settings` renders `credentials`\' `ConfigurationPreviewModal` for the `credential_ref` ' +
    'value type, statically imported, so nothing filters it: the gate is what stops the ' +
    'preview button appearing over an API that answers 503 while the module is off, and ' +
    'removing it would be a fail-open. It is the gate half of the reach ' +
    '`backend/scripts/ledgers/cross-module-imports/settings.ts` records, and **it retires ' +
    'with that reach and not before** — Z1 refuses a zone here (a modal that resolved to two ' +
    '`onClose`s has no honest answer), so what removes both is a single-contributor ' +
    'contribution point for the *field editor*, `settings` naming a place and `credentials` ' +
    'contributing picker and preview together. That needs an owner ruling; until it lands, ' +
    'the gate is the right code and this is the record of it.',

  // --- population 2: the kit rendering out of a module's namespace -----------
  //
  // R6 of `admin-kit-surface.md` refuses module knowledge in the kit, and R-1's
  // §9.2 ruled that a translation namespace is module knowledge: the bundle
  // behind it ships in a package the kit may not depend on, is resolved at
  // runtime by string, and a renamed key renders itself into the operator's
  // screen as a label. The remedy is a bundle move, not a prop.
  //
  // Two entries stood here when this ledger was written — `AssetPicker` and
  // `AssetUploader`, both naming `assets_library` — and **!1230 drained them
  // while this branch was open**. They are removed rather than left, which is
  // this ledger's stale direction working the first time it was asked: the
  // merge brought the repair in and the check went red on the two entries that
  // had outlived their sites, in the same run.
  // **And !1231 took the third, after both had merged.** `CategoryTreePicker`'s
  // seven `categoryTreePicker.*` keys moved to `core`, so this population is now
  // **empty**. The two merge requests were green apart and stale together: P4a
  // measured its ledger at `1de1673e6`, which held !1230 and not !1231, and the
  // entry only outlived its site once both were on `master`. A branch's own
  // pipeline cannot see that; the first run on the merge result is where it
  // showed, which is the shape AGENTS.md records for derived ledgers.
  //
  // The empty population is the argument for keeping this half of the check, not
  // for dropping it: nothing else in the estate would have found `CategoryTreePicker`,
  // and the next kit component to name a foreign namespace has no other reader.

  // --- population 3: a module screen rendering out of another's namespace ----
  //
  // The strings a screen shows ship in the bundle of the module that owns the
  // screen — feature 091 Phase 3's ruling for permission labels, one surface
  // over. Each of these retires when the screen moves into its module.
  //
  // **One of the four has already retired the other way.** P5a moved the shared
  // page-builder chrome's copy to `core`, so `InvoiceTemplateEditor` stopped
  // naming `cms` where it stands: the copy it renders belonged to no module in
  // the first place, which is the case where the bundle moves and the screen
  // does not.
  'admin/src/modules/orders/OrderShipmentsTab.tsx:module-namespace:inpost':
    "The InPost label button's own labels, beside the gate above it. This file is why §9.3 " +
    'folds the two populations into one finding rather than shipping them as two: it is in ' +
    'both, and they are one coupling. Retires with the gate, at batch 10.',
  // **The `carts` entry retired the way its own reason predicted** (P7b). The
  // cart-approval policy panel became `carts`' `organization.detail.after`
  // contribution rather than `organizations`' component, so the namespace it
  // names is its own. The file moved and the coupling went in the same merge
  // request, which is what this header asks a removal to say: it was the
  // repair, not the walk losing sight of the file. Worth one more sentence,
  // because the file was imported by nothing and the copy it named was in no
  // bundle under any spelling — the entry recorded a coupling that had never
  // rendered a word, and the repair is the first time the operator sees the
  // capability at all.
  // **`settings`' `ConfigurationReferenceInput` had the fourth entry and the
  // coupling is repaired, not relocated** (batch 10). It named `credentials`
  // for one label, `action.preview`, on the button that opens the credential
  // preview; the string a settings field renders belongs in the settings
  // bundle, so it is `editor.credentialRef.preview` there in both shipped
  // languages. Its screen moved into `@endora-commerce/mod-settings/admin` in
  // the same merge request, which is why the note above about the two
  // indistinguishable diffs exists: this entry would have read stale either
  // way, and only one of the two answers is a repair.
};
