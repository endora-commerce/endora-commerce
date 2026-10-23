# Tasks: Price-book editor (P2 of D-287)

**Input**: `specs/161-price-book-editor/` — `spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/ui-api-mapping.md`, `contracts/backend-gaps.md`, `contracts/csv-format.md`, `quickstart.md`.

**Tests**: required (Constitution III). In every phase the test tasks come first and must fail before
the implementation tasks start. UI tests use Testing Library with `admin/test/helpers/render-with-session.tsx`
and `admin/test/helpers/axe.ts` (`expectNoAxeViolations`). Every FR and SC is traced at the end.

**Order**: phases are **sequential**; each ends with a **checkpoint** (tests green, `typecheck` +
`lint` of the touched workspaces, UX-laws self-review for UI phases, coordinator review). Nothing
moves on before the checkpoint passes; no budget or assertion is loosened to pass one.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallel within the phase (different files, no dependency on an incomplete task)
- **[Story]**: US1–US9 of `spec.md`; setup, gap, foundation and closing phases carry none
- `PL/` = `packages/modules/price_lists/src/`, `AT/` = `admin/test/modules/price_lists/`,
  `CT/` = `backend/test/contract/price_lists/`, `AK/` = `packages/admin-kit/src/`

---

## Phase 1: Setup and baseline

- [x] T001 `git pull --rebase` on `feat/161-price-book-editor` (onto `origin/feat/160-pricing-model-v2`), `pnpm run build:packages`, run `pnpm --filter admin exec vitest run test/modules/price_lists` and `pnpm --filter backend exec vitest run test/contract/price_lists`; record the green baseline in the PR description draft
- [x] T002 [P] Write the shared admin test fixture for price books (books of `specs/pricing/worked-examples.md` §10.1–§10.4 as API responses, a representative session scoped to Acme, a platform-admin session) in `admin/test/helpers/price-book-fixtures.ts`
- [x] T003 [P] Record in `specs/161-price-book-editor/checklists/residue.md` every remaining reference to the temporary landing and the old screens (`/price-lists/display-modes` as index, `open-price-lists` target, "Price display modes" descriptions, `AppShell.tsx` comments, `price-lists-zones.test.tsx` assertions; grep `price-lists-engine`, `rule-targets`, `LinkedPriceLists`, `PriceMatrix`, `BracketGrid` over `backend/test/**`, `admin/test/**`, `storefront/test/**`, `packages/**`) — consumed by T101

**Checkpoint 1.**

---

## Phase 2: Backend gaps G11–G18 (`contracts/backend-gaps.md`)

### Tests first

- [x] T004 [P] G11 contract test in `CT/price-books-writable.test.ts`: `writable` on book and summary, `meta.creatableAudienceKinds`, `writable` on base prices, for a platform admin and a representative scoped to {Acme}
- [x] T005 [P] G12 contract test in `CT/price-book-targets-ids.test.ts`: `?ids=` labels in-scope organizations, omits out-of-scope and unknown ids without an error, refuses `ids` with `search`
- [x] T006 [P] G13 admin test in `admin/test/modules/audit_logs/audit-log-viewer-url-filters.test.tsx`: `/audit-log?objectType=price_list&objectId=<id>` opens filtered; changing a filter updates the URL
- [x] T007 [P] G14 integration test in `backend/test/integration/catalog/list-price-in-summaries.test.ts`: vectors D1–D4 on the listing response and on the product detail `resolvedPrice.listPrice`
- [x] T008 [P] G15 contract test in `CT/price-book-lines.test.ts`: a base book of 1 200 products (1–4 tiers each, variants on 100) at `pageSize=100` — no line split across pages (each line's rows equal the stored rows of that selection), variants on their product's page, `totalLines` correct, pages concatenate to every line exactly once in general-to-specific order; `kind` and `search` filters
- [x] T009 [P] G15 statement-count test in `CT/price-book-lines-statements.test.ts`: a page call issues the same number of statements for a 300-line and a 30 000-line book (since 2026-10-23 a 3 000-line book — ten times the small one and above the catalogue's 2 000 sparse-search limit — so the file seeds in seconds and stays inside its hook timeout under load; the 50 000-line scale is `PT/price_lists/book-lines-page.bench.ts`'s)
- [x] T010 [P] G15 catalogue port test in `backend/test/integration/catalog/page-product-ids-by-name.test.ts`: `pageProductIdsByName` orders by localized name, SKU, id; filters by name/SKU search; offset/limit; language fallback — **replaced in Phase 2b (T026) with the port it tests**
- [ ] T011 [P] G15 bench `backend/test/perf/price_lists/book-lines-page.bench.ts` (`PERF_RUN=true`): p95 of a 100-line page of a 50 000-line base book, first and last page, with and without search, asserted ≤ 150 ms; numbers recorded in the header — **written and run 2026-10-22: over budget** (p95 649 / 674 / 1 320 / 1 284 ms, numbers in the bench header); the budget stands; **superseded by the G15 redesign, Phase 2b (T029)**
- [x] T012 [P] G18 contract test in `CT/price-book-batch-scope.test.ts`: a base book of 6 000 rows accepts a batch; a non-base book refused at 5 001 rows; a 10-row batch issues the same number of statements on a 300-row and a 30 000-row book; replace mode on a large base book lists every removed row in the dry run
- [x] T013 [P] G16: extend `CT/price-books-resolve.test.ts` — E3.1 runner-ups carry `bookName` and `labels`
- [x] T014 [P] G17 unit tests moved to `packages/contracts/test/price-book-decimal.unit.test.ts` (every case of `PL/backend/services/matrix-decimal.test.ts`), plus a re-export identity test in `PL/backend/services/matrix-decimal.test.ts`

### Implementation

- [x] T015 G11 in `packages/contracts/src/price-books.ts` (`writable`, `creatableAudienceKinds`, base-prices `writable`) and `PL/backend/services/price-book-reads.ts` using `price-book-scope.ts`
- [x] T016 [P] G12 `ids` parameter in `PL/backend/routes.price-books.ts` (`targets/organizations`) through `organizationDetailsPort.findByIds` (existing, `packages/contracts/src/organizations.ts`)
- [x] T017 [P] G13 URL-backed filters in `packages/modules/audit_logs/src/admin/pages/AuditLogViewer.tsx`
- [x] T018 [P] G14 `listPrice` on `productResolvedPriceSchema` (`packages/contracts/src/price-lists.ts`) and on the catalogue summary (`packages/contracts/src/catalog.ts`); mapping in `packages/modules/catalog/src/backend/services/catalog-query.service.ts`
- [ ] T019 G15 `priceBookLinesQuerySchema`, `priceBookLineSchema`, `priceBookLinesResponseSchema` in `packages/contracts/src/price-books.ts`; `pageProductIdsByName` on `CatalogProductReadPort` (`packages/contracts/src/catalog.ts`) implemented in `packages/modules/catalog/src/backend/services/catalog-product-read.service.ts`; the lines read (distinct selections by kind, page cut, rows and labels for the page only) in `PL/backend/services/price-book-reads.ts`; route `GET /api/v1/admin/price-books/:id/lines` in `PL/backend/routes.price-books.ts` — **implemented as specified, contract and statement tests green; per-page time over the T011 budget**; **reworked in Phase 2b** (`research.md` R14)
- [x] T020 G18 scoped batch validation (rows of the touched selections, row count, replace-mode ids) and the base-book exemption from `PRICE_BOOK_MAX_ROWS` in `PL/backend/services/price-book-service.ts` and `price-book-batch.ts`
- [x] T021 [P] G16 candidate `bookName` and `labels` in `packages/contracts/src/price-books.ts` and `PL/backend/services/buyer-line-price-service.ts`
- [x] T022 [P] G17 move the decimal helpers to `packages/contracts/src/price-book-decimal.ts`, export from `packages/contracts/src/index.ts`, re-export from `PL/backend/services/matrix-decimal.ts`
- [x] T023 `minor` changesets `.changeset/161-contracts-editor-gaps.md`, `.changeset/161-price-lists-editor-gaps.md`, `.changeset/161-catalog-list-price-and-paging.md`, `.changeset/161-audit-logs-url-filters.md` (old and new shapes in each body); `pnpm --filter backend run check:release-intent`

**Checkpoint 2** — report G11–G18 to the 160 owner as built on the release branch.

---

## Phase 2b: G15 redesign and G19 (`research.md` R14–R15, `contracts/backend-gaps.md`)

The by-line read of T019 is correct but 4–9× over the 150 ms p95 budget, because the catalogue
derives and sorts 50 000 display names on every call. The redesign (prototyped on a 50 000-product
scratch database, `research.md` R14) gives the catalogue a stored, indexed admin name key and search
key per admin language, gives `price_lists` a per-book product-line table, and passes book membership
to the catalogue through a sanctioned subquery seam. **The budget is unchanged.**

### Tests first

- [x] T024 [P] Catalogue name-key rule test in `backend/test/integration/catalog/admin-name-key.test.ts`: the generated `admin_name_key_<lang>` and `admin_search_key_<lang>` equal the rule of `research.md` R14 for fixtures — two names in one language (`en-GB` and `en-US`), only a Polish name, empty names (→ SKU), diacritics (`ą`, `ł`, `ś`, `Ż`) folded, case folded; a product update, a product import and a bulk edit each move the key; the ORM never writes the columns
- [x] T025 [P] Name-rule parity test in `backend/test/integration/price_lists/admin-name-rule-parity.test.ts`: for the T024 fixtures read back from the database, `pickName` (the grid's label) equals `catalog_admin_display_name`, and the TypeScript fold used for the small kinds equals the SQL fold
- [x] T026 [P] Port test in `backend/test/integration/catalog/page-products-by-admin-name.test.ts` replacing `page-product-ids-by-name.test.ts`: `pageProductsByAdminName` with a membership seam — order by key, SKU, id; `total`; offset and limit; language `en` and `pl`, unknown → `en`; search by name and SKU and by a variant's SKU; the sparse (trigram) and dense (ordered walk) strategies return identical pages for the same query
- [x] T027 [P] Product-line table test in `backend/test/integration/price_lists/price-book-product-lines.test.ts`: the table equals `select distinct price_list_id, product_id` of `price_list_matrix_entries` after a batch add, a batch delete of a line's last row, a base-price write, a duplicate, a book delete, a product hard delete (cascade) and a variant delete that leaves a product line with no rows (removed by the catalogue-event reconciliation); the conversion backfill fills it
- [x] T028 [P] Rework `CT/price-book-lines.test.ts` (T008) and `CT/price-book-lines-statements.test.ts` (T009) to the new read: same assertions, plus `totalLines` from the line table, a sparse 300-line book, and searches on the sparse and dense paths; statement count constant for 300 and 30 000 lines, with and without search
- [x] T029 G15 bench rework in `backend/test/perf/price_lists/book-lines-page.bench.ts` (supersedes T011): a 50 000-product catalogue and a 50 003-line book plus a 300-line book; first, middle and last page; searches selective (`sku-0123`), broad (a name word), all-matching (a SKU prefix every product shares), two-character and no-match, first and last page each; 50 iterations; **each case asserted p95 ≤ 150 ms**; numbers recorded in the header — steady state 26/26 within 150 ms p95 in 3 runs after the Checkpoint 2b fix (ordered walk under `set local enable_sort = off`); fresh (no VACUUM) 22/26, reported
- [x] T030 [P] G19 test in `backend/test/integration/search/list-price-in-search.test.ts`: vectors D1–D4 of `specs/pricing/worked-examples.md` §10.15 on the search listing's `ProductSummary.resolvedPrice.listPrice` and on the suggestion items

### Implementation

- [x] T031 Catalogue migration (`pnpm --filter backend run migration:new`, owned by `catalog`): `create extension if not exists pg_trgm`; IMMUTABLE functions `catalog_admin_display_name`, `catalog_admin_name_key`; generated stored columns `admin_name_key_en`, `admin_name_key_pl`, `admin_search_key_en`, `admin_search_key_pl` on `products` (collation `"C"`); indexes `products_admin_order_<lang>` btree `(admin_name_key_<lang>, sku, id) include (admin_search_key_<lang>)`, GIN trigram on `admin_search_key_<lang>` and on `lower(product_variants.sku)`; the four properties mapped read-only on the `Product` entity in `packages/modules/catalog/src/backend/entities/product.entity.ts`
- [x] T032 Replace `pageProductIdsByName` with `pageProductsByAdminName({ membership, language, search?, offset, limit }) → { ids, total }` on `CatalogProductReadPort` (`packages/contracts/src/catalog.ts`) and in `packages/modules/catalog/src/backend/services/catalog-product-read.service.ts` (ordered index walk with hashed membership; search: trigram hits first when at most 2 000 lines match, ordered walk otherwise; one count statement); delete the old method and `page-product-ids-by-name.test.ts`
- [x] T033 `price_list_product_lines` (`price_list_id`, `product_id`, PK, both FKs `on delete cascade`): migration with backfill from `price_list_matrix_entries` (`migration:new`, owned by `price_lists`), entity, maintenance inside the batch write, the base-price write and duplicate (same transaction), reconciliation of row-less lines in the existing catalogue-event subscriber; the membership seam `priceBookMembership(bookId) → { sql, params }` in `PL/backend/services/price-book-membership.ts`
- [x] T034 Rework the lines read in `PL/backend/services/price-book-reads.ts`: a visibility-only header (no `tier_starts`/`row_count`), the small kinds ordered by the shared fold, `totalLines` from the line table without search and from the port with search, the page from the port, rows and labels for the page only
- [x] T035 G19: `listPrice` on the search summary's `resolvedPrice` and on suggestion items (`packages/contracts/src/search.ts`), mapped in `packages/modules/search/src/backend/services/search-query.service.ts` and `suggestion-pricing-enricher.ts`; the storefront search listing and typeahead render it through the components of Phase 9 — backend and contracts done; the storefront rendering done in Phase 9 (T086: the search listing's card and `renderSuggestionPrice`)
- [x] T036 Changesets: update `.changeset/161-catalog-list-price-and-paging.md` (port method replaced, generated columns) and add `.changeset/161-search-list-price.md` (`minor`, old and new shapes); `pnpm --filter backend run check:release-intent`
- [x] T037 Regenerate and commit `composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; `pnpm --filter backend run check:module-boundary` (the membership seam is the only cross-module SQL) and `check:platform-surface`
- [x] T038 Re-run `pnpm --filter backend run test:unit:fast`, `pnpm --filter backend exec vitest run test/contract/price_lists test/integration/catalog test/integration/price_lists test/integration/search`, `pnpm --filter @endora-commerce/contracts exec vitest run`, and T029 with `PERF_RUN=true`; record the bench numbers in `plan.md` *Measurements* and the bench header — re-run 2026-10-22 after the Checkpoint 2b fix

**Checkpoint 2b** — the bench meets 150 ms p95 on every case before Phase 3 starts.

---

## Phase 3: Foundations (blocking every story)

### Tests first

- [x] T039 [P] Editable grid primitive tests in `admin/test/kit/editable-grid.test.tsx`: ARIA grid roles, one tab stop and roving focus, arrows/Home/End/PageUp/PageDown, Enter/F2/Escape/Tab, Shift+arrow selection, TSV copy and paste of blocks, fill down (Ctrl/⌘+D), Delete, undo/redo groups, `aria-invalid` + `aria-describedby` per cell, live region mounted empty and then announcing, render count (typing re-renders only the edited cell and the status region), `expectNoAxeViolations` (FR-011, FR-031, FR-036)
- [x] T040 [P] Price-cell parser tests in `PL/admin/lib/price-cell.test.ts`: every input of `data-model.md` §4 (decimal comma/point, spaces, `zł`/`PLN`, Unicode minus, `%` with or without space, bounds −100…1000, ≤ 4/2 decimals), fixed on *all* refused (FR-007, FR-017)
- [x] T041 [P] Cell-label tests in `PL/admin/lib/cell-labels.test.ts`: the twelve `PRICE_BOOK_CELL_CODES` and four sources in words, in English and Polish
- [x] T042 [P] Routing, navigation and palette tests in `AT/price-books-surfaces.test.tsx`: routes `/price-lists`, `/price-lists/new`, `/price-lists/explain`, `/price-lists/display-modes`, `/price-lists/:id` with their permissions; sidebar entry opens `/price-lists`; palette actions `open-price-lists` (read), `new-price-book` (write), `open-price-explainer` (read) present by permission and absent when the module is off (FR-029) — the palette's filter is driven over the declared actions by `backend/test/unit/price_lists/palette-actions.test.ts` (the server resolves it); the module's off state is the platform axis (`nonDeactivatable`)
- [x] T043 [P] Update `AT/price-lists-zones.test.tsx`: the display-mode zones plus the new `product.editor.pricing.after` contribution, gated on `price_lists:read`, absent when the module is off — platform-axis off case added for all three zones

### Implementation

- [x] T044 [P] Generic editable grid in `AK/components/editable-grid/` (component, keyboard model, selection, clipboard, history, live region), exported from `AK/components/index.ts`; generic strings in the kit's core namespace (en + pl)
- [x] T045 [P] API client over every endpoint of `contracts/ui-api-mapping.md` with the contracts' Zod schemas in `PL/admin/lib/price-books-api.ts` — tested by `PL/admin/lib/price-books-api.test.ts`; the picker answers had no schema, so `priceBookRowsResponseSchema` and `priceBookTarget*ResponseSchema` were added to `packages/contracts/src/price-books.ts` and held by `CT/price-book-targets.test.ts`
- [x] T046 [P] Price-cell parser and formatter in `PL/admin/lib/price-cell.ts`; cell and source labels in `PL/admin/lib/cell-labels.ts`
- [x] T047 Routes, nav (back to `/price-lists`) and the zone in `PL/admin/index.ts`; empty page shells with titles
- [x] T048 Palette actions `open-price-lists` → `/price-lists`, `new-price-book` → `/price-lists/new`, `open-price-explainer` → `/price-lists/explain` in `PL/manifest.ts`; flat keys in `packages/modules/price_lists/i18n/en.json` and `pl.json`; run `pnpm --filter backend run check:action-route-permissions` and `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`
- [x] T049 Run `pnpm --filter backend run composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; commit the regenerated artefacts (module reference, sidebars, `admin/src/modules.generated.ts` if changed)

**Checkpoint 3** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 4: User Story 1 — Find, create and configure a price book (P1) 🎯 MVP

**Independent test**: create one book of each audience kind, activate, filter (spec US1).

### Tests first

- [x] T050 [P] [US1] List tests in `AT/price-books-page.test.tsx`: filters by type, status, currency, channel, audience kind, member (G12 labels the chip), search; columns incl. *applies to no one / nowhere*; base books marked one per currency with no delete/rename/schedule; filters reflected in the URL; loading skeleton, empty state (icon, line, *New price book*), error with retry; axe (FR-001, FR-005, FR-032)
- [x] T051 [P] [US1] Create-flow tests in `AT/price-book-create.test.tsx`: order type → currency → channels → audience → schedule/priority; channels limited to the currency with the reason for absent ones; pickers by kind; draft created; one primary action per step; axe (FR-002, FR-033)
- [x] T052 [P] [US1] Header tests in `AT/price-book-header.test.tsx`: currency read-only, audience kind read-only after activation, dormant binding text, member labels, `expectedVersion` on save and the stale message, activation refusal mapped to the step by `path`, delete confirmation naming the row count; history link to `/audit-log?objectType=price_list&objectId=` (FR-003, FR-004, FR-005)

### Implementation

- [x] T053 [US1] `PL/admin/pages/PriceBooksPage.tsx` (list, URL-backed filters, `ResponsiveTable`, `PaginationFooter`, organization/customer-group/sales-channel pickers)
- [x] T054 [US1] `PL/admin/pages/PriceBookCreatePage.tsx` (stepper with progress text, `creatableAudienceKinds`)
- [x] T055 [US1] `PL/admin/components/PriceBookHeaderForm.tsx` and the header tab of `PL/admin/pages/PriceBookPage.tsx` (activate/draftify/delete, `StickyFormActions`, unsaved-changes prompt)
- [x] T056 [US1] i18n en + pl for every US1 string in `packages/modules/price_lists/i18n/`

**Checkpoint 4** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 5: User Story 2 — Enter prices fast in the grid (P1)

**Independent test**: configure E1, E2 and E3 entirely in the grid; confirm through the explanation
API.

### Tests first

- [x] T057 [P] [US2] Grid layout tests in `AT/price-book-grid.layout.test.tsx`: lines ordered all → attribute → category → category ∩ attribute → product → variant (under its product) and by label; one column per `tierStarts`; kind shown as text + icon; reference "of base" on catalogue books and "of catalogue price" otherwise; the note linking the precedence view (FR-006, FR-007)
- [x] T058 [P] [US2] Inheritance tests in `AT/price-book-grid.inherit.test.tsx`: an empty cell shows "inherits from {start}: value" from the nearest lower tier covering it; "not priced by this line at this quantity" when none; never zero (FR-037)
- [x] T059 [P] [US2] Editing tests in `AT/price-book-grid.edit.test.tsx`: US2 scenarios 1–5 and 11 — bulk add of 40 products through the product picker (no duplicates), category/attribute/category∩attribute pickers offering only eligible attributes, typed values, block paste with normalisation and per-cell refusal, keyboard-only flow, bulk actions as one undo step, unsaved count, one batch on save with progress and live announcement (FR-008, FR-011–FR-013)
- [x] T060 [P] [US2] Variant and cell-detail tests in `AT/price-book-grid.variants.test.tsx`: expand a variant product, inherited variant cells, custom window 25–49 in the detail, clear (FR-009, FR-010)
- [x] T061 [P] [US2] Error and conflict tests in `AT/price-book-grid.errors.test.tsx`: `errors[]` with several rows marks every failing cell; `409 PRICE_BOOK_STALE` keeps the edits, reloads and offers re-apply; leaving with unsaved changes prompts; inactive and deleted-target lines show the reason (FR-014, FR-016, SC-005)
- [x] T062 [P] [US2] Paging and search tests in `AT/price-book-grid.paging.test.tsx`: pages of 50/100/200 lines from `GET …/lines` with page numbers and the total line count, a product's variants on its page, search by name/SKU/category/attribute and kind filter sent to the server, edits kept across pages and re-applied when a page is revisited; on a non-base book, adding lines past 5 000 rows refused before saving (FR-015)
- [x] T063 [P] [US2] Edit-state reducer tests in `PL/admin/lib/book-edit-state.test.ts`: `data-model.md` §3 (cell keys, groups, undo/redo, save body, error mapping by `index`/`rowId`, stale re-apply)
- [x] T064 [US2] Integration test in `backend/test/integration/price_lists/editor-batch-roundtrip.test.ts`: the save bodies the reducer builds for E1, E2 and E3 are accepted by `PUT …/rows` and the resolve endpoint returns E1.1, E2.1, E3.1

### Implementation

- [x] T065 [US2] `PL/admin/lib/book-edit-state.ts` (reducer, save body, error mapping)
- [x] T066 [US2] `PL/admin/components/PriceBookGrid.tsx` on the admin-kit grid (lines from `GET …/lines`, columns, inherited cells, kind rendering, toolbar with add/bulk actions, server search/filter, page numbers with `PaginationFooter`, page cache keyed by version)
- [x] T067 [US2] `PL/admin/components/CellDetailDialog.tsx` (custom window, inherited value, clear) on admin-kit's modal dialog
- [x] T068 [US2] Grid tab of `PL/admin/pages/PriceBookPage.tsx` (load, save, stale flow, unsaved prompt)
- [x] T069 [US2] i18n en + pl for every US2 string

**Checkpoint 5** — reached 2026-10-23; awaiting coordinator review. Includes the UX-laws review of the grid (Hick: toolbar ≤ 5 primary actions; Von Restorff: one primary *Save*; Fitts: destructive *Clear* apart; Postel: liberal input).

---

## Phase 6: User Story 3 — Base prices on the product (P1)

**Save path**: the panel's own *Save prices* with an unsaved-changes prompt (OQ-1 = B, FR-020 as
amended; one Save for the whole product page is issue #407).

### Tests first

- [x] T070 [P] [US3] Panel tests in `AT/product-base-prices.test.tsx`: one line per currency of `targets/currencies`; tiers; variant *inherits* / fixed / ± % / ± amount with a labelled preview computed by the contracts decimal helpers (G17); "not orderable without a base price" notice; read-only when `writable` is false (controls absent); errors on fields; axe (FR-019, FR-020, FR-030)
- [x] T071 [P] [US3] Books-on-the-product tests in `AT/product-price-books.test.tsx`: G1 list with audience and price, links to `/price-lists/:id` and `/price-lists/explain?productId=`, empty state (FR-021)
- [x] T072 [P] [US3] Save tests in `AT/product-base-prices.save.test.tsx`: *Save prices* sends one `PUT …/base-prices/:productId`, shows progress, cannot be double-submitted, announces the result; the unsaved-changes prompt fires on leaving the Pricing tab and the page (FR-020)

### Implementation

- [x] T073 [US3] `PL/admin/zones/ProductBasePrices.tsx` (panel + books list) contributed to `product.editor.pricing.after`
- [x] T074 [US3] i18n en + pl for every US3 string
- [x] T075 [US3] The panel's *Save prices* with `use-unsaved-changes-prompt` in `PL/admin/zones/ProductBasePrices.tsx`

**Checkpoint 6** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 7: User Story 4 — Duplicate (P2)

- [x] T076 [P] [US4] Tests in `AT/price-book-duplicate.test.tsx`: pre-filled dialog (name "(copy)", channels, currency, audience, multiplier 1); changed currency flags channels before submit; multiplier explains percentages are unchanged; opens the draft copy; source untouched (FR-022)
- [x] T077 [US4] `PL/admin/components/DuplicateDialog.tsx` and the header action; i18n en + pl

**Checkpoint 7** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 8: User Story 5 — Explain a price (P2)

- [x] T078 [P] [US5] Tests in `AT/price-explainer.test.tsx`: channel, currency, buyer (organization, customer, guest), lines; E3.1 answer 95.00 *buyer* *organization × product* with book and row links and runner-ups by name (G16); sale shows the beaten regular price; unpriced line explains and suggests a base price; pre-fill from `productId`, `variantId`, `organizationId`, `bookId`; axe (FR-023, FR-024)
- [x] T079 [P] [US5] Entry-point tests in `AT/price-explainer-entry-points.test.tsx`: links from the book header, a grid cell, the product panel and the organization display-mode zone open the screen pre-filled (FR-024)
- [x] T080 [US5] `PL/admin/pages/PriceExplainerPage.tsx`; links in the grid, header, product panel and `PL/admin/zones/OrganizationDisplayMode.tsx`; i18n en + pl

**Checkpoint 8** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 9: User Stories 6 and 7 — Precedence view, list-price switch, storefront pair

- [x] T081 [P] [US6] Tests in `AT/pricing-settings.precedence.test.tsx`: the page titled *Pricing settings*; preset name, twelve cells in order with an example each, category/attribute order; no control changes them; axe (FR-025)
- [x] T082 [P] [US7] Tests in `AT/pricing-settings.list-price.test.tsx`: switch reads and writes `settings/show-list-price`, default off, write gated on `price_lists:write`, saving announced (FR-026)
- [x] T083 [P] [US7] Storefront tests in `storefront/test/catalog/list-price-pair.test.tsx`: D1–D4 on the product page and listing card; never in the basket or checkout (FR-026, SC-007) — also the typeahead (G19, T035's storefront half) and the product page's net/gross switch; the basket and checkout held by a source sweep
- [x] T084 [US6] `PL/admin/components/PrecedenceView.tsx` in `PL/admin/pages/DisplayModeOverridesPage.tsx` (renamed *Pricing settings* in title and nav strings)
- [x] T085 [US7] `PL/admin/components/ShowListPriceSwitch.tsx` in the same page
- [x] T086 [US7] The pair in `storefront/components/pricing/BaseSalePriceBlock.tsx` and `storefront/components/PriceTag.tsx` from `resolvedPrice.listPrice` (G14); strings in `storefront/lib/i18n/messages.ts` (en + pl)
- [x] T086a [US6] Point the grid's precedence note (`PL/admin/components/PriceBookGrid.tsx`, *See the price precedence*, today `/price-lists/display-modes#precedence`) at the precedence view T084 adds — its section anchor on *Pricing settings* — test-first in `AT/price-book-grid.layout.test.tsx` (FR-037; coordinator, Checkpoint 5 review) — the address was already `#precedence`; the section now carries that id and, since a client-side navigation does not scroll to a fragment, scrolls itself into view and takes focus

**Checkpoint 9** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 10: User Story 8 — Representative scope across every screen (P2)

- [x] T087 [P] [US8] Tests in `AT/price-books-rep-scope.test.tsx` (representative scoped to Acme): A3.1 editable; A3.2 the book of Acme and Beta absent from the list and its address showing the same not-found page as an unknown id; A3.3 group book read-only with edit, import, duplicate and delete controls absent; create offers only organizations in scope; explanation and filters offer only in-scope organizations; base-price panel read-only (FR-027, FR-028, SC-006)
- [x] T088 [US8] Wire `writable`, `creatableAudienceKinds` and the not-found page through every screen (`PriceBooksPage`, `PriceBookPage`, `PriceBookCreatePage`, `PriceExplainerPage`, `ProductBasePrices`) — already carried by Phases 4–8 except *Duplicate*, which was offered on a book the caller may not change (A3.3); it now needs `writable`

**Checkpoint 10** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 11: User Story 9 — CSV export and import (P2)

### Tests first

- [x] T089 [P] [US9] Codec tests in `PL/admin/lib/price-book-csv.test.ts` (`contracts/csv-format.md`): export header in en/pl, BOM, `;`, decimal comma for Polish, a view over 5 000 rows split into numbered files of at most 5 000 rows; import of `;`/`,`, decimal comma/point, grouping space, quotes, Windows-1250 fallback, en/pl headers and kind aliases, unknown/duplicated/missing header refused, > 5 MB and > 5 000 lines refused before any request, line numbers on every local error; a 5 000-row file parses within the time recorded in the test header (FR-018, FR-038, FR-039)
- [x] T090 [P] [US9] Import dialog tests in `AT/price-book-import.test.tsx`: US9 scenarios 1–6 — round trip yields "no changes"; preview of changed/added/refused with line numbers; replace mode lists removed rows and their count; confirm disabled while any row is refused; nothing written before confirm; confirm sends one batch with the preview's `version`; stale refusal offers a new preview; encoding choice prompt; download of refused rows with reasons; import absent while the grid holds unsaved edits and for a read-only book; axe (FR-040–FR-042)
- [x] T091 [US9] Integration test in `backend/test/integration/price_lists/csv-import-roundtrip.test.ts`: an exported E3 book re-imported via `dryRun` gives an empty diff; a file with one change, one addition and one unknown SKU gives the expected diff and one error; confirmation writes exactly the diff (SC-009)

### Implementation

- [x] T092 [US9] `PL/admin/lib/price-book-csv.ts` (codec)
- [x] T093 [US9] `PL/admin/components/ImportDialog.tsx` (upload, encoding, mode, preview, refused-rows download, confirm) and the export action on `PriceBookPage` (reads `GET …/rows` 1 000 at a time for the current filter; numbered files of ≤ 5 000 rows) — both sit in the price grid's toolbar under *CSV file*, where the grid's filter and its unsaved edits are known (FR-042)
- [x] T094 [US9] i18n en + pl for every US9 string

**Checkpoint 11** — reached 2026-10-23; awaiting coordinator review.

---

## Phase 12: Cross-cutting and release readiness

- [x] T095 Accessibility sweep: an axe test per route in `AT/price-books-a11y.test.tsx` (list, create, book header, grid, import dialog, duplicate dialog, explainer, pricing settings, product panel); keyboard-only walk of US1–US3 scripted in the same file (SC-003, FR-031) — the keyboard walk found the create flow moving focus to each step's heading, as designed
- [x] T096 [P] States sweep in `AT/price-books-states.test.tsx`: loading within 400 ms (skeleton/progress), empty, error with retry and specific copy, saving with double-submit prevented, on every screen (FR-032) — found two gaps, fixed: the create flow's currency step had no loading or failure state, and the list-price setting's load failure had no retry
- [x] T097 [P] Primary-action sweep in the same files: one filled primary per view, destructive actions separated and confirmed (FR-033)
- [x] T098 [P] i18n completeness: `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts` and the admin i18n tests under `admin/test/i18n/` for every new key, en + pl; storefront keys in `storefront/test/` message tests (FR-035, SC-008)
- [x] T099 [P] Grid performance: render-count assertions of T039 extended to 200 lines × 6 columns in `admin/test/kit/editable-grid.perf.test.tsx` (typing and focus moves re-render a bounded set of cells; a 5 000-row save yields to the event loop between stages) (FR-036) — the 5 000-row test found two quadratics (4.3 s): `editCells` applies a change group in one pass and the edits are grouped by line once per edit map (~90 ms); in `PL/admin/lib/book-edit-state.perf.test.ts`
- [x] T100 [P] Off-state: extend `AT/price-books-surfaces.test.tsx` and the backend off-state suite (`backend/test/integration/price_lists/off-state.test.ts`) to the new routes, palette actions, pricing-tab zone and gap endpoints; run `pnpm --filter backend run check:off-state-coverage` (FR-029)
- [x] T101 Residue: work through `checklists/residue.md` (T003) — `AppShell.tsx` comments, i18n descriptions, `price-lists-zones.test.tsx`; grep `backend/test/**`, `admin/test/**`, `storefront/test/**`, `packages/**` for every name listed; fix or delete each hit (tests that *spawn* or import a deleted path included)
- [x] T102 Re-derive the module-removal residue ledger in `backend/test/unit/kernel/module-removal.test.ts` and any ledger derived from the touched locations, in the same commit — re-run 2026-10-23: 8/8, nothing moved; `price_lists` still carries no residue entry
- [x] T103 Regenerate: `pnpm --filter backend run composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; commit the artefacts; then `pnpm --filter backend run composer:check`, `pnpm --filter backend run manifests:check` and `pnpm --filter backend run overlay:check` — 2026-10-23: the generators wrote nothing new, the three checks pass, and `pnpm install --frozen-lockfile` is clean
- [x] T104 Changesets for the admin surfaces (`.changeset/161-price-lists-editor.md`, `.changeset/161-admin-kit-editable-grid.md`, `.changeset/161-storefront-list-price.md`); `pnpm --filter backend run check:release-intent` — the changes are covered by the per-phase `161-*` changesets; `storefront` is a private application and takes none
- [x] T105 Static estate: `pnpm run check:naming`, `pnpm run check:language`, and, each with `pnpm --filter backend run`: `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-boundary`, `check:platform-surface`
- [x] T106 Full verification: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter admin run test`, `pnpm --filter storefront run test`, `pnpm --filter '!backend' run test`, `pnpm --filter backend run test` on `dev:infra:test`; report every failure with its output
- [x] T107 Manual measurements of `quickstart.md` §3 (SC-001 walkthrough, SC-002, SC-004 wall-clock, FR-036 5 000-row save, SC-009 1 000-row preview) recorded in `plan.md` *Measurements* with the machine — the scriptable ones measured (FR-036, SC-009); SC-001, SC-002 and SC-004's wall-clock need a person and are listed there as such

**Checkpoint 12** — reached 2026-10-23. Coordinator review of the whole feature against the spec's acceptance scenarios.

---

## Phase 13: Release-gate hand-off

- [x] T108 Update `specs/160-pricing-model-v2/plan.md` *Release gate*: P2 complete, G11–G18 built; hand the screens' list (routes, zone, palette, settings) to feature 160 Phase 13 (FR-048 / SC-010 of spec 160 — the documentation rebuild covers these screens; nothing in `docs/` is written by this feature)
- [x] T109 Update `specs/pricing/current-model.md` where P1 described the admin surface as "P2 pending" (working rule of `specs/conventions/pricing.md`)

## Dependencies

Strictly sequential by phase (owner: quality over speed). Within a phase, `[P]` tasks may run
together. Phase 2 precedes every UI phase (screens use G11–G18); Phase 3 precedes every story phase;
the owner's rulings of 2026-10-22 are applied (OQ-1 = B, OQ-2 = B).

## Traceability

| Requirement | Tests |
| --- | --- |
| FR-001 | T050 |
| FR-002 | T051 |
| FR-003 | T052, T005 |
| FR-004 | T052 |
| FR-005 | T050, T052, T012 |
| FR-006 | T057, T008, T009, T024–T029 |
| FR-007 | T040, T057 |
| FR-008 | T059 |
| FR-009 | T060 |
| FR-010 | T060 |
| FR-011 | T039, T059 |
| FR-012 | T059 |
| FR-013 | T059, T063, T012 |
| FR-014 | T061, T063 |
| FR-015 | T062, T008, T009, T024–T029 |
| FR-016 | T061 |
| FR-017 | T040, T061 |
| FR-018 | T089, T091 |
| FR-019 | T070, T014 |
| FR-020 | T070, T072 |
| FR-021 | T071 |
| FR-022 | T076 |
| FR-023 | T078, T013 |
| FR-024 | T078, T079 |
| FR-025 | T081 |
| FR-026 | T082, T083, T007, T030 |
| FR-027 | T087, T004 |
| FR-028 | T087, T042 |
| FR-029 | T042, T043, T100 |
| FR-030 | T070, T014, T064 |
| FR-031 | T039, T095 |
| FR-032 | T050, T096 |
| FR-033 | T051, T097 |
| FR-034 | T050 (filters in the URL); primitive reuse reviewed at each checkpoint (no automated check of "reused rather than rebuilt") |
| FR-035 | T098 |
| FR-036 | T039, T099 (deterministic); wall-clock in T107 |
| FR-037 | T058 |
| FR-038 | T089, T090 |
| FR-039 | T089 |
| FR-040 | T090, T091 |
| FR-041 | T090, T091 |
| FR-042 | T090 |
| SC-001 | T064 (configuration reaches the vectors); the 10-minute walkthrough is the manual measurement T107 |
| SC-002 | manual measurement T107 |
| SC-003 | T095 |
| SC-004 | T039, T099 (render bounds); wall-clock T107 |
| SC-005 | T061 |
| SC-006 | T087 |
| SC-007 | T083, T007, T030 |
| SC-008 | T098 |
| SC-009 | T089, T090, T091; timing T107 |
