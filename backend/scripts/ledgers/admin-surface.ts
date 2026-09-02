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
 * reaches, and the 92 that remained fell into two groups, each with a retiring
 * condition that is somebody's next merge request rather than a sentence of
 * intent. **Both groups are now down to one entry each way**: what is left is
 * two keys, one component, and a mechanism that genuinely does not exist yet.
 *
 * ## Group A — the pickers over another module's data (0 sites)
 *
 * `organization-picker`, `sales-channel-picker`, `asset-picker` and
 * `cms-picker` each fetched from **another module's** API client, so publishing
 * them as they stood would have made the kit depend on module code and broken
 * R6 (*"the kit holds no module knowledge"*).
 *
 * **This group is empty, and it took two corrections to get there — both of
 * them to a retiring condition written here.** The first said the group
 * *"retires with Phase 2"*, when a module package could contribute the picker
 * to a zone; Phase 2 landed and retired none of them that way, because the zone
 * mechanism it would need is P4's and does not exist. What P2 did instead is
 * the exit batches three and five took for a module screen: the component
 * rebuilds its request from the published `apiClient` and the owner's
 * **contract** types, at which point it holds no module code to publish and
 * moves into the kit like any other composite. 15 of the 19 keys went that way.
 *
 * The second correction is `asset-picker`'s, and it is the one worth keeping in
 * view. This entry said the picker was left *"for a reason of kind rather than
 * of size"* — its module knowledge was `assets_library`' `AssetPicker`
 * **component**, so there was no URL to rebuild — and that it *"retires with
 * P4"*. `admin-component-contribution.md` Z1.1 measured one level deeper and
 * found the reason false: `AssetPicker` is 153 lines over one `GET`,
 * `AssetUploader` posts multipart to the origin the kit already publishes, and
 * every type all three name is `@endora-commerce/contracts`'. The whole cluster
 * was the P2 shape with one more component in the way, and P4c took P2's exit
 * with it — 19 keys, of which 4 were this ledger's and 15 the cross-module one's.
 * `admin/src` keeps a re-export shim at `components/asset-picker/AssetFieldPicker`;
 * the other three had no consumer outside a module directory and so no old path
 * left to forward.
 *
 * A reason that survives its own refutation is the thing this file is for, so
 * both corrections are recorded here rather than deleted with the keys.
 *
 * ## Group B — the admin's session and module-presence state (2 sites)
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
 * **37, by the time it landed**, and the extra one is the lesson repeating
 * inside the merge request that records it. `pim_pimcore` arrived on `master`
 * while P3 was in review, with an off-state test written against a tree where
 * `useAuth` was still mockable at `@/lib/auth`. It passes on `master`, P3 passes
 * without it, and only the **merge** holds both — a tree no pipeline builds. A
 * count is a description of one commit, and the population has to be re-derived
 * against the tree that will actually run.
 *
 * They drive the real providers now (`admin/test/helpers/render-with-session.tsx`),
 * seeded through `initial` on both, which is a better test on its own terms: a
 * permission gate asserted against a stub of the predicate asserts that the stub
 * was consulted.
 *
 * **What is left is one tab component, and it is not two.** This entry read
 * *"the two tab components … each renders on two modules' pages and belongs to
 * neither"*. Measured, that was true of one of them. `InvoiceSectionTabs`' two
 * tabs are both `/invoices*`, its presence gate asks about `invoices`, and both
 * of its consumers are `invoices`' own screens — so it belonged to `invoices`
 * entirely and needed no mechanism at all. P4c moved the file into
 * `admin/src/modules/invoices/components/` and its two keys went with it.
 * `OrderEntryTabs` is the real case and keeps the sentence: it spans `orders`
 * and `quick_order`, and its own comment says the strip must lose one tab rather
 * than the strip when `quick_order` goes off.
 *
 * Nothing here is an exception to a rule. Every entry is a reach that should
 * one day be a bare specifier into a published subpath, and it has a named
 * event that removes it.
 */

export interface UnpublishedAdminReach {
  /** The symbols the reach names. Named, not counted — the verdict is per symbol. */
  readonly symbols: readonly string[];
  /** Why this reach stands, and what removes it. */
  readonly reason: string;
}

const ORDER_ENTRY_TABS =
  'A host component that reads module presence to decide which of its tabs to render. The ' +
  'four hooks this group was named for are the kit’s since P3, and its other tab component ' +
  '(`InvoiceSectionTabs`) turned out to be `invoices`’ own and moved there in P4c. This one ' +
  'is the genuine case: `OrderEntryTabs` sits in `admin/src/components/` because it renders ' +
  'on `orders`’ and `quick_order`’s pages and belongs to neither, and its own comment says ' +
  'the strip must lose one tab rather than the whole strip when `quick_order` goes off. ' +
  'Publishing it would put that pairing in the kit, which is module knowledge (R6). ' +
  'Retires with **P4**, in batch 10: a tab strip over two modules’ surfaces is a zone with ' +
  'two contributions — the kit renders `<RouteTabsZone name="order.entry.tabs" />` over ' +
  '`useAdminZone`, `orders` contributes the standard tab and `quick_order` the quick one, ' +
  'and *“fewer than two tabs is not a choice”* becomes the strip counting contributions the ' +
  'hook has already filtered. At that point this ledger is empty and its two-way ratchet is ' +
  'the ordinary kind.';

export const UNPUBLISHED_ADMIN_REACHES: Readonly<Record<string, UnpublishedAdminReach>> = {
  'admin/src/modules/orders/OrderCreatePage.tsx::admin/src/components/OrderEntryTabs.tsx': { symbols: ['OrderEntryTabs'], reason: ORDER_ENTRY_TABS },
  'admin/src/modules/quick_order/QuickOrderOnBehalfPage.tsx::admin/src/components/OrderEntryTabs.tsx': { symbols: ['OrderEntryTabs'], reason: ORDER_ENTRY_TABS },
};
