/**
 * The module ids this repository writes as **string literals** in files the
 * module does not own — `check:admin-zones`' sixth finding (feature 091, P4a;
 * `contracts/admin-component-contribution.md` §5.1 as §9.3 widened it).
 *
 * ## Why a ledger at all, in a feature that is trying to empty them
 *
 * The predicate is red on eleven sites the day it lands, and every one of them
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
 * mounts (batches 8 and 10), the three `kit-namespace` entries when the kit's
 * strings move to `core` under R-1's §9.2 ruling, and the four
 * `module-namespace` entries as their screens move into the modules that own
 * them. An entry that ever reads *"this is fine"* means the predicate has
 * outgrown its population — narrow it, never add the entry.
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
 * ## What is **not** here, and why the population is eleven rather than §9.3's twelve
 *
 * §9.3 measured five `module-namespace` sites and the walk finds four. The
 * fifth is `admin/src/_shared/email-builder/EmailEditorPane.tsx`'s
 * `useTranslation('cms')`, and it is out of the population by the attribution
 * rule §5.1 names as an argument *against* the finding: ownership comes from
 * the route table and the nav, `_shared` is claimed by neither, and a file no
 * nav entry claims is the admin application's own. Judging it would file a
 * reach under a module that does not own it. That is the fail-closed direction
 * and it is stated here rather than discovered later — the site is real, it is
 * recorded in `research.md` §6.6 as being in no ledger at all, and where
 * `_shared` goes is an open owner decision (`plan.md` § *Phase 4* P5) that a
 * ledger cannot answer.
 */

/** One recorded coupling: a reason, and — where the key covers more than one site — a count. */
export type ForeignModuleIdEntry = string | { readonly sites: number; readonly reason: string };

export type ForeignModuleIdLedger = Readonly<Record<string, ForeignModuleIdEntry>>;

export const FOREIGN_MODULE_IDS: ForeignModuleIdLedger = {
  // --- population 1: a visibility gate naming another module -----------------
  //
  // All four are correctly gated on both axes and all four are FR-007's case:
  // the host names the owner because there is no place for the owner to
  // contribute to. Each retires into a zone contribution, and the enum member
  // it needs arrives with the batch that renders it.
  'admin/src/modules/delivery_methods/DeliveryMethodsPage.tsx:visibility-gate:dhl_parcel':
    'The integrations card holds a hard-coded `dhl_parcel` block. Retires at batch 8, when ' +
    '`delivery_methods` renders `delivery_method.list.integrations` and `dhl_parcel` — ' +
    'already a package — contributes to it.',
  'admin/src/modules/delivery_methods/DeliveryMethodsPage.tsx:visibility-gate:inpost':
    "The same card's hard-coded `inpost` block. Retires at batch 8 with its sibling: both " +
    'contributors are packaged already, so the whole conversion is one batch\'s.',
  'admin/src/modules/orders/OrderDetail.tsx:visibility-gate:payments':
    "The payments tab button is rendered here, in the file's own words, so the gate is here " +
    'too. Retires at batch 10, when `orders` renders `order.detail.tabs` and `payments` ' +
    'contributes the tab.',
  'admin/src/modules/orders/OrderShipmentsTab.tsx:visibility-gate:inpost':
    'The InPost label button, and the reach `068-inpost-shipping` made by editing this file ' +
    '— the one FR-007 cites by name. Retires at batch 10 into `order.shipment.row.actions`, ' +
    "a repeated parameterised zone whose props carry the row's `deliveryMethodCode`, with " +
    '`dhl_parcel` as its second contributor.',

  // --- population 2: the kit rendering out of a module's namespace -----------
  //
  // R6 of `admin-kit-surface.md` refuses module knowledge in the kit, and R-1's
  // §9.2 ruled that a translation namespace is module knowledge: the bundle
  // behind it ships in a package the kit may not depend on, is resolved at
  // runtime by string, and a renamed key renders itself into the operator's
  // screen as a label. The remedy is a bundle move, not a prop.
  'packages/admin-kit/src/components/asset-picker/AssetPicker.tsx:kit-namespace:assets_library':
    'Six keys only the kit reads. §9.2 puts the repair in !1225, the merge request that ' +
    'created the site: the eleven `assets_library` keys move to `core`, which is what the ' +
    "kit's other nine `useTranslation` call sites already name.",
  'packages/admin-kit/src/components/asset-picker/AssetUploader.tsx:kit-namespace:assets_library':
    'Five keys only the kit reads, the other half of the same eleven. Retires with its ' +
    'sibling in !1225.',
  'packages/admin-kit/src/components/category-tree-picker/CategoryTreePicker.tsx:kit-namespace:catalog':
    'Seven `categoryTreePicker.*` keys, read by nothing outside the kit. It has shipped in ' +
    'this state since Phase 1b, and §9.2 gives it a standalone merge request having no other ' +
    'subject: it retires when those seven keys move to `core`. This entry is the reason the ' +
    'population is worth counting — nothing in the estate would ever have found it.',

  // --- population 3: a module screen rendering out of another's namespace ----
  //
  // The strings a screen shows ship in the bundle of the module that owns the
  // screen — feature 091 Phase 3's ruling for permission labels, one surface
  // over. Each of these retires when the screen moves into its module.
  'admin/src/modules/invoices/templates/InvoiceTemplateEditor.tsx:module-namespace:cms':
    'The invoice template editor renders the CMS page builder and takes its chrome copy from ' +
    "`cms`' bundle. Retires when the page-builder family becomes D-192's package and the " +
    'editor names its own strings.',
  'admin/src/modules/orders/OrderShipmentsTab.tsx:module-namespace:inpost':
    "The InPost label button's own labels, beside the gate above it. This file is why §9.3 " +
    'folds the two populations into one finding rather than shipping them as two: it is in ' +
    'both, and they are one coupling. Retires with the gate, at batch 10.',
  'admin/src/modules/organizations/panels/CartApprovalPolicyPanel.tsx:module-namespace:carts':
    "The cart approval policy is `carts`' concept rendered on an organization's screen, so " +
    "the copy follows the concept. Retires when the panel becomes `carts`' own contribution " +
    "rather than `organizations`' component.",
  'admin/src/modules/settings/components/ConfigurationReferenceInput.tsx:module-namespace:credentials':
    'The credential picker inside a settings field. It is the same reach that sends ' +
    "`ConfigurationPreviewModal` to `./admin-ui` rather than to the kit — the namespace is " +
    'the whole of its module knowledge (Z1.1, §9.2) — and it retires in batch 9 with it.',
};
