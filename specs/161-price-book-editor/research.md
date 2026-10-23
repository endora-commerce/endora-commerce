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

Reading the code against every FR of the spec found **nine** further gaps (G18 after the
coordinator's review of 2026-10-22; G19 with the G15 redesign, R14–R15). Each becomes a backend
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
| G19 | The search module's `resolvedPrice` (search listing summaries in `packages/modules/search/src/backend/services/search-query.service.ts`, suggestion items in `suggestion-pricing-enricher.ts`) carries base, sale and display mode but not `listPrice`, so a search-backed storefront listing cannot show the list-price pair catalogue cards show (G14) | FR-026, SC-007 |

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
- **G15** — **page by line**, not by row (coordinator review, 2026-10-22). *The first implementation of
  this design missed the budget 4–9×; its redesign is R14, which supersedes the cost steps below.* A new read
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
`/price-lists/new` (write), `open-price-explainer` → `/price-lists/explain` (read), `open-pricing-settings` → `/price-lists/display-modes` (read; added by
the coordinator's Checkpoint 10 ruling, Principle XVI — the page has no sidebar entry, so the palette and
a *Pricing settings* link in the list header reach it); keys in the
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

## R14. G15 redesign — meeting 150 ms p95 at 50 000 lines (measured)

**Problem (measured by the dev, bench header of `backend/test/perf/price_lists/book-lines-page.bench.ts`).**
The first by-line read ran p95 645 / 690 ms (first / last page) and ≈ 1 300 ms with search on a
50 003-line, 126 003-row book: 38 ms for a header that aggregates the whole book, 59 ms for the book's
product ids, and **428 ms in `catalogProductReadPort.pageProductIdsByName`**, which derives each of
50 000 display names through `pickName`'s fallback chain in SQL and sorts them on every call.

**Prototype.** A scratch database cloned from the current test template
(`b2b_test_tpl_ee67e276b7fa`, the release-branch schema), seeded with 50 000 products (English and
Polish names; 100 with two English names; 2 500 variants) and a 50 001-line, 125 003-row book plus a
300-line book; local test Postgres 16 (the `postgres-test` container); 50 iterations after 5 warm-ups;
the whole DB side of one call (visibility header, small kinds, count, page ids, page rows, page labels,
page variants). The prototype (seed, DDL, queries and a 50-iteration harness) lived outside the repository and was
never in the tree; the scratch database was dropped after measuring.

**Chosen design.**

1. **Catalogue-owned stored sort and search keys, maintained by Postgres.** `catalog` adds two
   IMMUTABLE SQL functions — `catalog_admin_display_name(name, sku, lang)` (the rule below) and
   `catalog_admin_name_key(name, sku, lang)` (its fold) — and four **generated stored** columns on
   `products`: `admin_name_key_en`, `admin_name_key_pl` (collation `"C"`) and `admin_search_key_en`,
   `admin_search_key_pl` (= key ‖ `' '` ‖ `lower(sku)`). *Who maintains them*: Postgres, on every
   insert and update of `products` — admin writes, imports, bulk edits, PIM writes, SQL migrations — so
   there is no write path to forget and no drift. *Backfill*: the `alter table … add column … generated
   always as (…) stored` of `catalog`'s migration computes them for every row (measured 3.5–7 s per
   column at 50 000 products; a table rewrite under an exclusive lock, which on a 1 M-product catalogue
   would be minutes — acceptable with no production deployment, and recorded as the caveat if one
   appears). *Write cost*: about 1 ms per product update including the index updates (measured on 100
   updates: 98 ms). *Languages*: the admin UI languages (`en`, `pl`, `AdminMe.preferredLanguage`);
   another admin language is a migration adding its two columns and indexes; an unknown language reads
   `en`. Indexes: `products_admin_order_<lang>` btree `(admin_name_key_<lang>, sku, id) include
   (admin_search_key_<lang>)` (7.3 MB at 50 000), GIN trigram on `admin_search_key_<lang>` (8.4 MB) and
   on `lower(product_variants.sku)` (0.2 MB).
2. **A per-book product-line table in `price_lists`.** `price_list_product_lines (price_list_id,
   product_id)` — one row per product line (product or variant rows), PK, both FKs `on delete cascade`
   (6 MB for 50 000 lines). Maintained in the same transaction by every `price_lists` write that adds
   or removes product or variant rows (batch write, base-price write, duplicate, the conversion
   backfill); a product hard delete cascades; a variant delete that leaves a product line with no rows
   is reconciled by the catalogue-event subscriber `price_lists` already has. It turns "which products
   does this book hold" from 125 003 rows with duplicates into 50 000 unique keys.
3. **Membership through a sanctioned subquery seam** (precedent: `CustomFieldListFilterPort.condition`,
   `packages/contracts/src/custom-fields.ts`): `price_lists` hands the catalogue `{ sql: 'select
   l.product_id from price_list_product_lines l where l.price_list_id = ?', params }`; the catalogue
   embeds it as `(p.id in (<seam>)) is true` — a **hashed** sub-plan probed while walking its own
   `products_admin_order_<lang>` index in order (index-only, `Heap Fetches: 0`). Neither module's code
   names the other's table. The port becomes `pageProductsByAdminName({ membership, language, search?,
   offset, limit }) → { ids, total }`.
4. **Search** uses `pg_trgm`, already installed in the platform by `product_feeds`' migration
   (`20260802T110630_product_feeds_taxonomies.ts`); `catalog`'s migration runs `create extension if
   not exists pg_trgm` itself, because it must not depend on `product_feeds` being installed (Complexity
   Tracking). The count is one statement over the membership-filtered order index with `like` on the
   stored search key (or a variant SKU in a hashed trigram hit set); the page takes the **trigram hits
   first** when at most 2 000 lines match (small result, sorted) and the **ordered walk** otherwise
   (many matches, the first 100 come quickly) — the catalogue picks from the count it has just made.
5. **`totalLines`**: without search, `count(*)` of the book's line rows (PK index-only); with search,
   the catalogue's count above. Exact in both, and never a scan of the whole book's rows.
6. **A visibility-only header** for the lines read (audience kind, members, `isSystem`): `tier_starts`
   and `row_count` are the book read's, which the grid calls once per load.

**Measured (p95 of the DB side of one call; 50 iterations).**

| Case | 50 001-line book | 300-line book |
| --- | --- | --- |
| first page | 35.8 ms | 10.2 ms |
| middle page (offset 25 000) | 31.7 ms | 12.8 ms |
| last page | 36.2 ms | 12.2 ms |
| search broad `screw` (7 128 matches), first / last | 75.7 / 77.4 ms | 32.0 / 31.0 ms |
| search selective `sku-0123` (100), first / last | 54.9 / 55.4 ms | 21.3 / 20.8 ms |
| search two-character `cr` (7 128), first / last | 80.3 / 82.3 ms | 46.5 / 45.5 ms |
| search all-matching `sku` (50 000), first / last | 61.1 / 79.5 ms | 64.7 / 62.0 ms |
| search no match `zz`, first / last | 64.4 / 63.3 ms | 40.6 / 40.8 ms |

EXPLAIN ANALYZE (single runs, instrumented): line count `count(*)` over `price_list_product_lines`
7–22 ms; first page = index-only scan of `products_admin_order_en` with the hashed membership sub-plan
(build ≈ 8–17 ms over 50 000 line keys), `Heap Fetches: 0`; last page (offset 49 900) the same scan
reading 50 000 entries, 68 ms instrumented / 36 ms p95 uninstrumented; search count 45 ms; selective
search page (trigram bitmap on `products_admin_search_en_trgm`, 117 candidates, membership by PK
probe) 3.3 ms. The largest case leaves about 65 ms of the 150 ms budget for the HTTP, authorisation,
validation and label work in Node, which the bench T029 measures end to end; the selective-search
count (≈ 45 ms, a scan of the order index) is the known headroom if it is ever needed (a capped
trigram pre-count).

**Implementation follow-up (Checkpoint 2b, measured 2026-10-22).** Two statements did not plan as the
prototype assumed, and both are pinned in the code with the measurement beside them:

- *The ordered page* (no search, and the dense search strategy) was planned as a seq scan of `products`
  plus a sort of every member, before **and** after `VACUUM ANALYZE`: the hashed membership filter
  `(p.id in (…)) is true` is estimated at a fixed half of the table, and on unanalysed data the planner
  also assumes a few thousand rows and an empty visibility map, so it prices the index walk above the
  sort (84–92 ms; walking: 32 ms vacuumed, 59 ms unvacuumed with 50 003 heap fetches). No query shape
  kept the walk on unanalysed data — an `offset 0`-fenced ordered subquery, `limit all`, a keyset walk
  in 2 000-row index-range chunks — so the page statement runs in its own transaction under
  **`set local enable_sort = off`**, which ends with that transaction (`catalog-product-read.service.ts`
  `withSort`). The sparse strategy must sort its materialised trigram hits (with the sort off the
  planner abandons the trigram index, ≈ 400 ms), so it runs under `enable_sort = on`, restated so both
  strategies issue the same statements. The search count stays a seq scan: exact and plan-insensitive.
- *The page-rows read* (`price-book-reads.ts` `lines`) of `price_list_matrix_entries` used only
  `price_list_id` as its index condition on unanalysed data (the 125 003-row book estimated at 86
  rows) and filtered the whole book: 27–40 ms against 0.5 ms. The page's product rows are read through
  a `LATERAL` per id fenced with `offset 0`, so each probe is an index lookup on `(price_list_id,
  product_id)` in both states (0.66 ms); `price-book-lines-rows-plan.test.ts` holds it (on a 3 000-line,
  12 000-row book since 2026-10-23: twelve times the 1 000-row ceiling it asserts, seeded in seconds).

**Fresh state — accepted (owner, 2026-10-22).** Before autovacuum's first pass over a freshly loaded
catalogue, the broadest searches on the 50 003-line book run about 150–153 ms p95 end to end (bench
T029, `plan.md` *Measurements*): the search count and the dense walk read every product's heap tuple
while the visibility map is empty. The owner accepted this overrun: the 150 ms budget is measured in
the **steady state**, which every case meets. The fresh-state behaviour is followed up in issue #409;
the bench keeps reporting it.

**The name rule, and how it relates to `pickName`.** Display name for admin language `L`: the
non-empty name whose language tag's primary subtag is `L`, taking the **alphabetically first tag**
when there are several (`en-GB` before `en-US`); else the same for English; else the first non-empty
name by tag; else the SKU. Sort key: that name case-folded and accent-folded (NFKD, combining marks
removed, `ł→l`, `đ→d`, `ø→o`, `ß→s`, `æ→a`), compared bytewise (`"C"`), ties by SKU then id —
deterministic and independent of the database's locale. `pickName`
(`PL/backend/services/price-book-reads.ts`) tries the exact tag first and then the same primary subtag
in the object's key order; for names read from `jsonb` (whose key order is length, then bytes) that is
the same choice, so the **grid's label and its order agree**, and T025 pins it. The two can differ
only for a product with **two names in the same language** (`en-GB` and `en-US` both set), if a caller
built the name object in another key order — never from the database. The order itself differs from
the old `localeCompare` order only in folding: accented letters sort with their base letter (`Ążur`
with `A`, `Łącznik` with `L`), a deliberate, locale-independent choice.

**The PDP and the cards need not agree with the grid**: the storefront picks a product's name by the
channel's language (`pickLang` in `catalog-query.service.ts`: request language, channel default
language, `en-US`, `en`, any), for buyers; the grid picks by the administrator's UI language, for staff,
and is the only surface that orders by this key. Neither reads the other's choice.

**Rejected, with the measurement that rejected it** (same scratch database):

| Option | Measured | Why rejected |
| --- | --- | --- |
| Status quo: id list → catalogue derives `pickName` in SQL and sorts | 263 ms DB (428 ms in the app) | per-call derivation and sort of 50 000 names |
| (1) Reshape the port only: subquery instead of id list (dev) | 181 ms | still derives and sorts every name |
| (3a) Expression index on an IMMUTABLE key function, no stored column | first 20 ms, **last 1 467 ms** | Postgres still evaluates the function for every row it sorts or returns (≈ 28 µs each) |
| (3b) Stored key + `exists` semi-join to `price_list_matrix_entries` | first 2.7 ms, middle **206 ms**, last 72 ms | the planner switches to a hash join over 125 003 rows and a sort as the offset grows |
| Stored key + materialised `distinct` + join + sort | 128–168 ms | sorts 50 000 rows per call |
| Stored key + hashed membership over `price_list_matrix_entries` (no line table) | 40–110 ms for the membership alone | 125 003 rows with duplicates; the line table builds the same hash from 50 000 keys in 8–17 ms |
| Search as an `OR` in the ordered walk, function-computed text | 149 ms selective, 1 160 ms broad | the `OR` defeats the trigram index; computing the text per row costs ≈ 45 µs |
| (4) Cache the order per book version and language | — | every save moves the version, so the editor would pay the full cost on the first page after each save; not needed once (1)–(3) meet the budget |
| (2) Lighter header alone | saves ≈ 38 ms | necessary, adopted, but far from sufficient |
| Keyset cursor instead of page numbers | first/next ≈ 3 ms | not needed: with the hashed walk an offset costs ≤ 36 ms p95, so page numbers (R2) stay |

## R15. G19 — the list price on search-backed listings

`packages/modules/search/src/backend/services/search-query.service.ts` projects
`ProductSummary.resolvedPrice` as `{ basePrice, salePrice, displayMode }` and
`suggestion-pricing-enricher.ts` adds `basePrice`/`salePrice` to suggestion items; both drop the
`listPrice` the batched resolution already returns (`ListingPriceDetail.listPrice`, G9). The fix maps it
through, in the search module's own code and its contracts (`packages/contracts/src/search.ts`), so the
storefront search listing and typeahead render the pair exactly as catalogue cards do (G14). Tested
with vectors D1–D4 (T030).

