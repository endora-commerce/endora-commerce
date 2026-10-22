# Research — Price-book editor (feature 161, P2 of D-287)

Phase 0 of `/speckit.plan`, written against the **implemented** P1 on the release branch
(`origin/feat/160-pricing-model-v2` at `2910477da`): the routes of
`packages/modules/price_lists/src/backend/routes.price-books.ts`, the schemas of
`packages/contracts/src/price-books.ts`, and the admin surface left by P1
(`packages/modules/price_lists/src/admin/index.ts`). Every item is *Decision → Rationale →
Alternatives rejected*. `PL/` = `packages/modules/price_lists/src/`, `CON/` =
`packages/contracts/src/`, `AK/` = `packages/admin-kit/src/`.

---

## R1. What P1 delivered, and what the editor still lacks

**Finding.** G1–G10 of the spec are implemented: the list filters including `productId` with
`matches` (G1, `CON/price-books.ts` `priceBookSummarySchema.matches`), row `labels`, `targetDeleted`
and `naturalKey` (G2), row `search` (G3), `tierStarts` on book and summary (G4), `version` +
`expectedVersion`/`If-Match` + `409 PRICE_BOOK_STALE` (G5, `PL/backend/services/price-book-service.ts`),
every refused row in `errors[]` (G6), base books through `PUT …/rows` (G7), the `show-list-price`
setting through the Command Bus (G8, `routes.price-books.ts` `settings/show-list-price`), `listPrice` on
`ListingPriceDetail` (G9, `CON/price-lists.ts`), and the `?dryRun=true` preview with natural keys and
merge/replace (G10, `priceBookRowsDryRunSchema`).

Reading the code against every FR of the spec found **eight** further gaps (G18 added after the
coordinator's review of 2026-10-22). Each becomes a backend
task in this feature, ahead of the screens that need it (`contracts/backend-gaps.md`):

| # | Gap | Found in | Needed by |
| --- | --- | --- | --- |
| G11 | No "may this caller change it" on a book: `PriceBook`/`PriceBookSummary` carry no `writable`, the list carries no creatable audience kinds, base prices carry no `writable`. The rule exists server-side (`PL/backend/services/price-book-scope.ts` `bookWritable`, `audienceKindWritable`) and the admin cannot derive it: `AdminMe` (`AK/lib/auth.tsx`) carries permissions, not the organization scope | FR-027, FR-028, US8 |
| G12 | Book members are ids only (`priceBookSchema.audience.memberIds`) and `GET …/targets/organizations` searches by name only — a stored organization member cannot be labelled | FR-003, US1 |
| G13 | The audit-log viewer (`packages/modules/audit_logs/src/admin/pages/AuditLogViewer.tsx`) keeps its filters in component state; a "history of this book" link cannot pre-filter it | spec *Assumptions* (book history) |
| G14 | `listPrice` exists on `ListingPriceDetail` but **not** on `productResolvedPriceSchema` (`CON/price-lists.ts`) nor on the catalogue's `ProductSummary` (`CON/catalog.ts`); `catalog-query.service.ts` never maps it, so neither the PDP nor the cards can render the pair | FR-026, SC-007 |
| G15 | `GET …/rows` pages **rows** (`pageSize ≤ 1000`) while the grid pages **lines** (a selection with several tiers, a product with its variants): a page boundary can split a line; and every call reads and labels the **whole** book (`price-book-reads.ts` `rows` → `storedRows` + `label`), a cost that grows with the book — base books hold a row per product tier and variant across the catalogue, far beyond 5 000 | FR-006, FR-013, FR-015 |
| G16 | Explanation candidates carry `bookId`, `rowId`, `cell`, `amount` only (`priceBookExplanationCandidateSchema`); the screen must name each runner-up's book and selection | FR-023 |
| G17 | The decimal arithmetic the server prices with (`PL/backend/services/matrix-decimal.ts` — `applySignedPercent`, `applyAmountAdjustment`, half-up 4 dp) is module-private; the base-price panel's "resulting price" preview must use the identical rounding (FR-030) | FR-019, FR-030 |
| G18 | The batch write validates against the **whole** stored book (`price-book-service.ts` `writeRows` → `#storedRows`) and refuses any book over `PRICE_BOOK_MAX_ROWS` (5 000, `price-book-batch.ts`) — including base books, which the base-price endpoint grows past 5 000 on any real catalogue, so the base grid could never save; the same whole-book read makes every save cost O(book) | FR-005, FR-013, FR-017, US1 scenario 6 |

**Rejected.** Deriving writability in the browser from the book's audience: the browser does not know
the caller's organization scope, and a second copy of the scope rule is the drift P1's `price-book-scope.ts`
exists to prevent.

## R2. Gap designs (summarised; full shapes in `contracts/backend-gaps.md`)

- **G11** — `writable: boolean` on `PriceBook` and `PriceBookSummary`, computed by `bookWritable`;
  `meta.creatableAudienceKinds` on the list response (`audienceKindWritable`); `writable` on
  `productBasePrices` (base books: `bookWritable` of the base book). Additive.
- **G12** — `GET …/targets/organizations?ids=a,b` (≤ 1000, the member cap), scope-filtered like the
  search; ids outside scope are simply absent. Chosen over embedding names in `PriceBook`, because the
  same lookup labels the list's member filter chip and the explanation's buyer.
- **G13** — `AuditLogViewer` reads `objectType`/`objectId` (and `action`) from the URL query on mount
  and writes them back on change. A change in `audit_logs`' admin, owned there, tested there.
- **G14** — `productResolvedPriceSchema` gains `listPrice?`; `catalog-query.service.ts` maps
  `ListingPriceDetail.listPrice` into `ProductSummary.resolvedPrice` (product detail) and into the
  listing summary for cards; the storefront renders it (US7). The decision of *whether* to show stays
  server-side (P1's `listPriceOf`, setting + "above the buyer price").
- **G15** — **page by line**, not by row (coordinator review, 2026-10-22). A new read
  `GET …/:id/lines?page&pageSize&kind&search` (pageSize 50/100/200 lines, max 500) answers
  `{ data: PriceBookLine[], meta: { page, pageSize, totalLines } }`, a line being one selection with
  **all** its rows, and a product line carrying its variant lines; the existing row endpoint is kept for
  export and for callers that want rows. Order is general → specific (FR-006): `all`, attributes,
  categories, category ∩ attribute, products (with variants), by label within a kind. **Cost per page
  does not grow with the book**: (1) one index-only statement over `price_list_matrix_entries
  (price_list_id, …)` yields the book's distinct selections per kind and their counts — ids only, no
  labels; (2) the page is cut in that ordering: the small kinds (attributes, categories) are labelled
  in full (they are few), and the product segment is ordered by the catalogue through a new
  `catalogProductReadPort.pageProductIdsByName({ ids, search, language, offset, limit })` (owned by
  `catalog`: `select id from products where id = any(?) [and name/sku match] order by name, sku, id
  offset ? limit ?`); (3) rows and labels are read **only for the page's lines**. Search runs in the
  same steps (labels of the small kinds, the catalogue's search for products). **Page numbers rather
  than infinite scroll**: the grid is a keyboard-first ARIA grid whose `aria-rowcount` must be honest
  and whose "go to line N" must not depend on having scrolled there; page numbers keep focus,
  announcement and unsaved-edit bookkeeping deterministic, match the admin's list pattern
  (`PaginationFooter`), and each page is one bounded request. Tested by a book larger than one page
  (no line split, correct `totalLines`, pages concatenate to every line exactly once in order), a
  statement-count test (constant per page whatever the book size) and a p95 bench at a 50 000-line
  base book.
- **G16** — candidates gain `bookName` and `labels` (`priceBookRowLabelsSchema`), resolved in the same
  batch as the winner's.
- **G18** — batch validation reads only what it needs: the stored rows of the **selections the batch
  touches** (overlap is a per-selection rule, `price-book-batch.ts` `rowOverlaps`), the book's row
  **count** for the limit, and — in replace mode only — the ids of every stored row (index-only). The
  5 000-row cap stays for non-base books (feature 148's product decision) and **does not apply to base
  books**, which are bounded by the catalogue (FR-009 of spec 160). Tested by a base book above 5 000
  rows accepting a batch, a non-base book refused at 5 001, and a statement-count test.
- **G17** — move the pure decimal helpers to `CON/price-book-decimal.ts`; `matrix-decimal.ts` re-exports
  them so the server keeps one implementation. Unit tests move with them.

## R3. Routes, navigation and palette

**Decision.** Admin routes, all in `PL/admin/index.ts`, static segments before `:id`:

| Route | Screen | Permission |
| --- | --- | --- |
| `/price-lists` (index, nav) | book list | `price_lists:read` |
| `/price-lists/new` | create flow | `price_lists:write` |
| `/price-lists/explain` | explanation | `price_lists:read` |
| `/price-lists/display-modes` | *Pricing settings* (existing page, extended) | `price_lists:read` |
| `/price-lists/:id` | book: header tab, grid tab, import/export | `price_lists:read` |

`/price-lists/:id` is also what P1's audit reference resolver already links
(`PL/backend/services/audit-references.ts`). The sidebar entry returns to `/price-lists`. Palette
(manifest `actions`): `open-price-lists` → `/price-lists` (read), `new-price-book` →
`/price-lists/new` (write), `open-price-explainer` → `/price-lists/explain` (read); keys in the
module's flat `i18n/{en,pl}.json`; `check:action-route-permissions` and
`test/unit/_i18n/registered-bundles-shape.test.ts` hold them
(`specs/conventions/module-admin-surfaces.md` §Command palette).

**Rejected.** Keeping the list behind the display-mode page's button: sidebar-only discovery of the
main editor contradicts Principle XVI's intent.

## R4. The editable grid — one admin-kit primitive

**Decision.** `AK/components/editable-grid/` — an ARIA `grid` (WAI-ARIA Authoring Practices
data-grid pattern): one tab stop, roving `tabindex`, arrows/Home/End/PageUp/PageDown, Enter/F2 edit,
Escape cancel, Tab commits and moves, rectangular selection with Shift+arrows, copy/paste of TSV
blocks, fill down, clear, undo/redo over an edit history, `aria-rowcount`/`aria-colcount` with
`aria-rowindex` for paging, row and column headers, per-cell `aria-invalid` + `aria-describedby`,
and a polite live region mounted empty. It knows nothing about prices: cells are parsed and rendered
by caller-supplied functions; the price-book grid supplies the price-cell parser (US2 scenario 2) and
the inherited-value renderer (FR-037).

**Rationale.** FR-034 requires a shared primitive where none fits; admin-kit has a read-only
`ResponsiveTable` and `table.tsx`, and the only editable cells (`payment-method-availability`) are
single toggles. A generic grid is the reusable thing; the pricing rules stay in the module.

**Rejected.** A third-party data-grid library (AG Grid, TanStack Table + editing): a new runtime
dependency (Principle IV) for features we specify exactly; virtualised scrolling: not needed at
200 lines a page (spec *Assumptions*).

**Render budget.** Cells are memoised by `(value, state)`; typing re-renders the edited cell and the
status region only — asserted by a render-count test, which is the deterministic proxy for SC-004's
"under 100 ms" (the wall-clock measure is a recorded manual check, `quickstart.md`).

## R5. Unsaved edits, save and conflicts

**Decision.** A module-local reducer (`PL/admin/lib/book-edit-state.ts`) holds the loaded book
(`version`, rows), an edit map keyed by `(selection, minQuantity)`, the undo stack, and per-cell
errors. Save sends **one** `PUT …/rows` with `expectedVersion` and the edits as `upsert`/`delete`
(merge mode); `errors[]` (G6) maps back to cells by `index`/`rowId`; `409 PRICE_BOOK_STALE` keeps
the edit map, reloads the book and offers *re-apply my edits* (FR-014, SC-005). Leaving with edits
uses admin-kit's `use-unsaved-changes-prompt.ts`.

## R6. CSV export and import (FR-018, FR-038–FR-042)

**Decision.** Pure codec in `PL/admin/lib/price-book-csv.ts`:

- **Export**: rows read through the row endpoint page by page (≤ 1 000 a call) for the current
  filter, split into numbered files of at most 5 000 rows when larger (FR-018), written in the fixed
  format of
  `contracts/csv-format.md`: UTF-8 with BOM, `;` separator, decimal comma when the admin language is
  Polish (point otherwise, stated in the file name), header names in the admin language.
- **Import**: size check (≤ 5 MB) before reading; decode with `TextDecoder('utf-8', { fatal: true })`,
  falling back to `windows-1250` with an explicit encoding choice offered when UTF-8 fails (both are
  WHATWG encodings — no dependency); separator sniffed from the header line (`;` or `,`); headers
  recognised in English and Polish; each line parsed to a `PriceBookBatchRowInput` with a natural
  `key` (G10); ≤ 5 000 rows refused before the request. The preview is the server's
  `PUT …/rows?dryRun=true` answer (FR-040): local parse errors and server `errors[]` shown together by
  file line; confirm re-sends the same body without `dryRun` and with the preview's `version`.

**Rejected.** Column mapping UI (spec *Out of Scope*); parsing in a worker thread (5 MB parses in well
under a second in a main-thread pass; measured in the codec's test with a 5 000-row file).

## R7. Base-price panel in the product editor (FR-019–FR-021)

**Finding.** The product editor's *Pricing* tab hosts zones `product.editor.pricing.before` (PIM
panels) and `product.editor.pricing.after` ("P2's base-price zone contributes here",
`packages/modules/catalog/src/admin/pages/ProductEditor.tsx`). **Zone contributions have no way to
take part in the host's Save**: every existing zone panel saves itself (e.g.
`packages/modules/sales_channels/src/admin/zones/ProductChannelMembership.tsx` through
`EntityChannelMembership`), and admin-kit's zone API (`AK/zones/`) offers no save participation.

**Consequence.** FR-020 ("the panel MUST save with the product editor's save action") needs either a
new zone save-participation contract in admin-kit and the catalogue host, or a change of the FR to a
panel with its own save. **Owner ruling (OQ-1 = B, 2026-10-22)**: the panel has its own *Save prices*
with an unsaved-changes prompt (FR-020 amended); one Save for the whole product page is issue #407.

**Decision.** The panel lists one line per currency from `GET …/targets/currencies`,
reads `GET …/base-prices?productId=`, writes `PUT …/base-prices/:productId`, previews variant
results with G17's helpers, and shows the books pricing the product from G1 (FR-021) with links to
`/price-lists/:id` and `/price-lists/explain?productId=`.

## R8. Explanation screen (FR-023, FR-024)

`POST …/resolve` with up to 200 lines; buyer pickers: `OrganizationPicker` /`CustomerPicker` from
admin-kit restricted by `targets/organizations` (scope-filtered); channel and currency from
`targets/sales-channels` and `targets/currencies`; pre-fill from the query string (`productId`,
`variantId`, `organizationId`, `bookId`). Cells in words from a shared label map of
`PRICE_BOOK_CELL_CODES`; runner-ups from G16.

## R9. Precedence view and the list-price setting (FR-025, FR-026)

The display-mode page (`PL/admin/pages/DisplayModeOverridesPage.tsx`) is renamed *Pricing settings*
and gains two sections: the read-only precedence (`GET …/precedence`, `precedenceViewSchema`) with the
twelve cells in order and an example sentence each; and the *Show list price* switch (`GET`/`PUT
…/settings/show-list-price`). Storefront: `BaseSalePriceBlock` / `PriceTag` render
`resolvedPrice.listPrice` on the PDP and cards (G14), never in the basket or checkout.

## R10. Representative scope in the UI (FR-027)

All visibility is the server's (P1): hidden books never arrive, a direct address answers `404` → the
module's not-found page (same page as an unknown id, SC-006). Writability is G11's flag: edit controls
are **not rendered** when `writable` is false (FR-028: absent, not disabled); the create flow offers
only `meta.creatableAudienceKinds`; organization pickers use the scope-filtered targets.

## R11. Off-state (Principle XVII)

Nothing new: admin contributions of a switched-off module are dropped by `AdminContributionsProvider`
(routes, nav, palette, zones), and the API answers `MODULE_DISABLED`. Tests extend
`admin/test/modules/price_lists/price-lists-zones.test.tsx` and the backend off-state suite to the new
routes, palette actions and the pricing-tab zone.

## R12. Residue of the old screens

**Finding.** P1 already deleted the old pages, components, zones and admin tests (160 T124); what
remains is the temporary landing (`ROUTE_PATH = '/price-lists/display-modes'` in `PL/admin/index.ts`,
the palette action targeting it, i18n descriptions "Price display modes"), comments in
`packages/admin-shell/src/components/AppShell.tsx` and the assertions of
`admin/test/modules/price_lists/price-lists-zones.test.tsx` ("exactly the two display-mode members").
**Decision**: restore the landing to `/price-lists`, update those assertions, grep `backend/test/**`,
`admin/test/**`, `storefront/test/**` for `price-lists-engine`, `rule-targets`, `LinkedPriceLists`,
`PriceMatrix`, `BracketGrid`, and re-derive the module-removal residue ledger in the same commit.

## R13. No new dependency

React, admin-kit, Radix primitives, `TextDecoder` (windows-1250 included), `Blob`/`URL.createObjectURL`
for export, `axe-core` already an admin devDependency (147). Nothing to add.
