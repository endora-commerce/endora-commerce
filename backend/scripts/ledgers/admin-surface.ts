/**
 * Reaches into admin platform surface `@endora-commerce/admin-kit` does not
 * publish (feature 091, Phase 1b; `contracts/admin-kit-surface.md` R15).
 *
 * Two-way: an unledgered reach fails, and so does an entry describing a reach
 * this run no longer sees — including a **symbol** an entry names and the walk
 * does not, because the verdict is per symbol and an entry that only counted
 * them could not be checked against the barrel it disagrees with.
 *
 * R15 said this ledger opens **empty**. It does not, and the correction is
 * recorded in the contract: Phase 1b publishes 1690 of the 1782 measured host
 * reaches, and the 92 that remain fall into exactly two groups, each with a
 * retiring condition that is somebody's next merge request rather than a
 * sentence of intent.
 *
 * ## Group A — the pickers over another module's data (4 sites)
 *
 * `organization-picker`, `sales-channel-picker`, `asset-picker` and
 * `cms-picker` each fetched from **another module's** API client, so publishing
 * them as they stood would have made the kit depend on module code and broken
 * R6 (*"the kit holds no module knowledge"*).
 *
 * **P2 answered three of the four, and the answer was not the one written
 * here.** This entry said the group *"retires with Phase 2"*, when a module
 * package could contribute the picker to a zone. Phase 2 landed and retired
 * none of them, because the zone mechanism it would need is P4's and does not
 * exist. What P2 did instead is the exit batches three and five took for a
 * module screen: the component rebuilds its request from the published
 * `apiClient` and the owner's **contract** types, at which point it holds no
 * module code to publish and moves into the kit like any other composite. 15 of
 * the 19 keys went that way, and `admin/src` keeps a re-export shim at each old
 * path, so the reach is repaired rather than reclassified.
 *
 * **What is left is `asset-picker`, and it is left for a reason of kind rather
 * than of size.** Its module knowledge is `assets_library`' `AssetPicker`
 * **component**, not a request, so there is no URL to rebuild and no contract
 * type that replaces it. It is FR-007's own worked example and **retires with
 * P4** — `registryZones()`, an `<AdminZone>` renderer and the visibility gate —
 * which is what `plan.md` § *Phase 4* means by *"P2 does not cover
 * `asset-picker`"*. Its second half, the `assets_library` admin client the field
 * picker calls to resolve an id, takes the client exit and can be paid first;
 * both are recorded from the picker's own side in
 * `backend/scripts/ledgers/cross-module-imports/host.ts`.
 *
 * ## Group B — the admin's session and module-presence state (4 sites)
 *
 * **P3 paid 64 of this group's 68 keys**, and the four hooks it was named for —
 * `lib/auth`, `lib/module-presence`, `lib/surface-visibility` and
 * `lib/use-page-size-preference` — are `@endora-commerce/admin-kit/lib`'s. What
 * blocked them was never a design question; it was the measurement recorded
 * here, and P3 is the merge request that paid it: `vi.mock` keys on a module id,
 * so moving `surface-visibility` into the package alongside `auth` put that seam
 * **inside** the package, where a test's mock could not reach it.
 *
 * The size of that is worth leaving written down, because this entry carried two
 * different numbers and neither was current. It said *"23 files, 104 tests"* —
 * Phase 1b's count of the files that would actually **break** — while
 * `plan.md`'s P3 row said *"49 admin test files mock at least one of the four"*,
 * which was the **union** on the day that row was written and had grown to 58 by
 * the time P3 ran. Measured by doing it: **36 files and 179 tests**, every one of
 * them failing with `useAuth must be used inside <AuthProvider>`. The union was
 * never the blast radius — a screen that reaches `useAuth` directly keeps its
 * mock working through the shim; what breaks is a subject whose gate runs
 * *inside* the package.
 *
 * They drive the real providers now (`admin/test/helpers/render-with-session.tsx`),
 * seeded through `initial` on both, which is a better test on its own terms: a
 * permission gate asserted against a stub of the predicate asserts that the stub
 * was consulted.
 *
 * **What is left is the two tab components**, which are not hooks and were never
 * blocked by the same thing. Each renders on two modules' pages and belongs to
 * neither, so publishing one would put that pairing — module knowledge — in the
 * kit. They retire with **P4**, like `asset-picker`: a tab strip over two
 * modules' surfaces is a zone with two contributions.
 *
 * Nothing here is an exception to a rule. Every entry is a reach that should
 * one day be a bare specifier into a published subpath, and both groups have a
 * named event that removes them.
 */

export interface UnpublishedAdminReach {
  /** The symbols the reach names. Named, not counted — the verdict is per symbol. */
  readonly symbols: readonly string[];
  /** Why this reach stands, and what removes it. */
  readonly reason: string;
}

const PICKERS =
  'A picker over another module’s data: the component renders that module’s own ' +
  '`AssetPicker`, so publishing it would put module knowledge in the kit (R6). It is ' +
  'FR-007’s worked example, and the one member of this group a request cannot answer — ' +
  'P2 retired the other three by rebuilding their calls from the published `apiClient`. ' +
  'Retires with **P4**, when a zone lets `assets_library` contribute the component and ' +
  'the host render a slot.';

const SESSION =
  'A host component that reads module presence to decide which of its tabs to render. The ' +
  'four hooks this group was named for are the kit’s since P3; what is left is two ' +
  'components that sit in `admin/src/components/` because each renders on two modules’ ' +
  'pages and belongs to neither — `InvoiceSectionTabs` on `invoices` and its templates ' +
  'screen, `OrderEntryTabs` on `orders` and `quick_order`. Publishing one would put that ' +
  'pairing in the kit, which is module knowledge (R6). Retires with **P4**: a tab strip over ' +
  'two modules’ surfaces is a zone with two contributions.';

export const UNPUBLISHED_ADMIN_REACHES: Readonly<Record<string, UnpublishedAdminReach>> = {
  'admin/src/modules/blog/pages/BlogCategoryEditor.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/invoices/InvoicesList.tsx::admin/src/components/InvoiceSectionTabs.tsx': { symbols: ['InvoiceSectionTabs'], reason: SESSION },
  'admin/src/modules/invoices/templates/InvoiceTemplatesPage.tsx::admin/src/components/InvoiceSectionTabs.tsx': { symbols: ['InvoiceSectionTabs'], reason: SESSION },
  'admin/src/modules/megamenu/components/MenuItemConfigPanel.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/orders/OrderCreatePage.tsx::admin/src/components/OrderEntryTabs.tsx': { symbols: ['OrderEntryTabs'], reason: SESSION },
  'admin/src/modules/quick_order/QuickOrderOnBehalfPage.tsx::admin/src/components/OrderEntryTabs.tsx': { symbols: ['OrderEntryTabs'], reason: SESSION },
  'admin/src/modules/settings/components/AssetIdSettingInput.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
  'admin/src/modules/transactional_emails/components/BrandingPanel.tsx::admin/src/components/asset-picker/AssetFieldPicker.tsx': { symbols: ['AssetFieldPicker'], reason: PICKERS },
};
