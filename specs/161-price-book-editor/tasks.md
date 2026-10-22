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

- [ ] T001 `git pull --rebase` on `feat/161-price-book-editor` (onto `origin/feat/160-pricing-model-v2`), `pnpm run build:packages`, run `pnpm --filter admin exec vitest run test/modules/price_lists` and `pnpm --filter backend exec vitest run test/contract/price_lists`; record the green baseline in the PR description draft
- [ ] T002 [P] Write the shared admin test fixture for price books (books of `specs/pricing/worked-examples.md` §10.1–§10.4 as API responses, a representative session scoped to Acme, a platform-admin session) in `admin/test/helpers/price-book-fixtures.ts`
- [ ] T003 [P] Record in `specs/161-price-book-editor/checklists/residue.md` every remaining reference to the temporary landing and the old screens (`/price-lists/display-modes` as index, `open-price-lists` target, "Price display modes" descriptions, `AppShell.tsx` comments, `price-lists-zones.test.tsx` assertions; grep `price-lists-engine`, `rule-targets`, `LinkedPriceLists`, `PriceMatrix`, `BracketGrid` over `backend/test/**`, `admin/test/**`, `storefront/test/**`, `packages/**`) — consumed by T112

**Checkpoint 1.**

---

## Phase 2: Backend gaps G11–G17 (`contracts/backend-gaps.md`)

### Tests first

- [ ] T004 [P] G11 contract test in `CT/price-books-writable.test.ts`: `writable` on book and summary, `meta.creatableAudienceKinds`, `writable` on base prices, for a platform admin and a representative scoped to {Acme}
- [ ] T005 [P] G12 contract test in `CT/price-book-targets-ids.test.ts`: `?ids=` labels in-scope organizations, omits out-of-scope and unknown ids without an error, refuses `ids` with `search`
- [ ] T006 [P] G13 admin test in `admin/test/modules/audit_logs/audit-log-viewer-url-filters.test.tsx`: `/audit-log?objectType=price_list&objectId=<id>` opens filtered; changing a filter updates the URL
- [ ] T007 [P] G14 integration test in `backend/test/integration/catalog/list-price-in-summaries.test.ts`: vectors D1–D4 on the listing response and on the product detail `resolvedPrice.listPrice`
- [ ] T008 [P] G15 contract test in `CT/price-book-rows-page-size.test.ts`: a 5 000-row book returns in one response at `pageSize=5000`; `pageSize=5001` refused; response time recorded in the file header against the runner's measured baseline
- [ ] T009 [P] G16: extend `CT/price-books-resolve.test.ts` — E3.1 runner-ups carry `bookName` and `labels`
- [ ] T010 [P] G17 unit tests moved to `packages/contracts/test/price-book-decimal.unit.test.ts` (every case of `PL/backend/services/matrix-decimal.test.ts`), plus a re-export identity test in `PL/backend/services/matrix-decimal.test.ts`

### Implementation

- [ ] T011 G11 in `packages/contracts/src/price-books.ts` (`writable`, `creatableAudienceKinds`, base-prices `writable`) and `PL/backend/services/price-book-reads.ts` using `price-book-scope.ts`
- [ ] T012 [P] G12 `ids` parameter in `PL/backend/routes.price-books.ts` (`targets/organizations`) through `organizationDetailsPort.findByIds` (existing, `packages/contracts/src/organizations.ts`)
- [ ] T013 [P] G13 URL-backed filters in `packages/modules/audit_logs/src/admin/pages/AuditLogViewer.tsx`
- [ ] T014 [P] G14 `listPrice` on `productResolvedPriceSchema` (`packages/contracts/src/price-lists.ts`) and on the catalogue summary (`packages/contracts/src/catalog.ts`); mapping in `packages/modules/catalog/src/backend/services/catalog-query.service.ts`
- [ ] T015 [P] G15 `pageSize` maximum in `priceBookRowsQuerySchema` (`packages/contracts/src/price-books.ts`)
- [ ] T016 [P] G16 candidate `bookName` and `labels` in `packages/contracts/src/price-books.ts` and `PL/backend/services/buyer-line-price-service.ts`
- [ ] T017 [P] G17 move the decimal helpers to `packages/contracts/src/price-book-decimal.ts`, export from `packages/contracts/src/index.ts`, re-export from `PL/backend/services/matrix-decimal.ts`
- [ ] T018 `minor` changesets `.changeset/161-contracts-editor-gaps.md`, `.changeset/161-price-lists-editor-gaps.md`, `.changeset/161-catalog-list-price.md`, `.changeset/161-audit-logs-url-filters.md` (old and new shapes in each body); `pnpm --filter backend run check:release-intent`

**Checkpoint 2** — report G11–G17 to the 160 owner as built on the release branch.

---

## Phase 3: Foundations (blocking every story)

### Tests first

- [ ] T019 [P] Editable grid primitive tests in `admin/test/kit/editable-grid.test.tsx`: ARIA grid roles, one tab stop and roving focus, arrows/Home/End/PageUp/PageDown, Enter/F2/Escape/Tab, Shift+arrow selection, TSV copy and paste of blocks, fill down (Ctrl/⌘+D), Delete, undo/redo groups, `aria-invalid` + `aria-describedby` per cell, live region mounted empty and then announcing, render count (typing re-renders only the edited cell and the status region), `expectNoAxeViolations` (FR-011, FR-031, FR-036)
- [ ] T020 [P] Price-cell parser tests in `PL/admin/lib/price-cell.test.ts`: every input of `data-model.md` §4 (decimal comma/point, spaces, `zł`/`PLN`, Unicode minus, `%` with or without space, bounds −100…1000, ≤ 4/2 decimals), fixed on *all* refused (FR-007, FR-017)
- [ ] T021 [P] Cell-label tests in `PL/admin/lib/cell-labels.test.ts`: the twelve `PRICE_BOOK_CELL_CODES` and four sources in words, in English and Polish
- [ ] T022 [P] Routing, navigation and palette tests in `AT/price-books-surfaces.test.tsx`: routes `/price-lists`, `/price-lists/new`, `/price-lists/explain`, `/price-lists/display-modes`, `/price-lists/:id` with their permissions; sidebar entry opens `/price-lists`; palette actions `open-price-lists` (read), `new-price-book` (write), `open-price-explainer` (read) present by permission and absent when the module is off (FR-029)
- [ ] T023 [P] Update `AT/price-lists-zones.test.tsx`: the display-mode zones plus the new `product.editor.pricing.after` contribution, gated on `price_lists:read`, absent when the module is off

### Implementation

- [ ] T024 [P] Generic editable grid in `AK/components/editable-grid/` (component, keyboard model, selection, clipboard, history, live region), exported from `AK/components/index.ts`; generic strings in the kit's core namespace (en + pl)
- [ ] T025 [P] API client over every endpoint of `contracts/ui-api-mapping.md` with the contracts' Zod schemas in `PL/admin/lib/price-books-api.ts`
- [ ] T026 [P] Price-cell parser and formatter in `PL/admin/lib/price-cell.ts`; cell and source labels in `PL/admin/lib/cell-labels.ts`
- [ ] T027 Routes, nav (back to `/price-lists`) and the zone in `PL/admin/index.ts`; empty page shells with titles
- [ ] T028 Palette actions `open-price-lists` → `/price-lists`, `new-price-book` → `/price-lists/new`, `open-price-explainer` → `/price-lists/explain` in `PL/manifest.ts`; flat keys in `packages/modules/price_lists/i18n/en.json` and `pl.json`; run `pnpm --filter backend run check:action-route-permissions` and `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`
- [ ] T029 Run `pnpm --filter backend run composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; commit the regenerated artefacts (module reference, sidebars, `admin/src/modules.generated.ts` if changed)

**Checkpoint 3.**

---

## Phase 4: User Story 1 — Find, create and configure a price book (P1) 🎯 MVP

**Independent test**: create one book of each audience kind, activate, filter (spec US1).

### Tests first

- [ ] T030 [P] [US1] List tests in `AT/price-books-page.test.tsx`: filters by type, status, currency, channel, audience kind, member (G12 labels the chip), search; columns incl. *applies to no one / nowhere*; base books marked one per currency with no delete/rename/schedule; filters reflected in the URL; loading skeleton, empty state (icon, line, *New price book*), error with retry; axe (FR-001, FR-005, FR-032)
- [ ] T031 [P] [US1] Create-flow tests in `AT/price-book-create.test.tsx`: order type → currency → channels → audience → schedule/priority; channels limited to the currency with the reason for absent ones; pickers by kind; draft created; one primary action per step; axe (FR-002, FR-033)
- [ ] T032 [P] [US1] Header tests in `AT/price-book-header.test.tsx`: currency read-only, audience kind read-only after activation, dormant binding text, member labels, `expectedVersion` on save and the stale message, activation refusal mapped to the step by `path`, delete confirmation naming the row count; history link to `/audit-log?objectType=price_list&objectId=` (FR-003, FR-004, FR-005)

### Implementation

- [ ] T033 [US1] `PL/admin/pages/PriceBooksPage.tsx` (list, URL-backed filters, `ResponsiveTable`, `PaginationFooter`, organization/customer-group/sales-channel pickers)
- [ ] T034 [US1] `PL/admin/pages/PriceBookCreatePage.tsx` (stepper with progress text, `creatableAudienceKinds`)
- [ ] T035 [US1] `PL/admin/components/PriceBookHeaderForm.tsx` and the header tab of `PL/admin/pages/PriceBookPage.tsx` (activate/draftify/delete, `StickyFormActions`, unsaved-changes prompt)
- [ ] T036 [US1] i18n en + pl for every US1 string in `packages/modules/price_lists/i18n/`

**Checkpoint 4.**

---

## Phase 5: User Story 2 — Enter prices fast in the grid (P1)

**Independent test**: configure E1, E2 and E3 entirely in the grid; confirm through the explanation
API.

### Tests first

- [ ] T037 [P] [US2] Grid layout tests in `AT/price-book-grid.layout.test.tsx`: lines ordered all → attribute → category → category ∩ attribute → product → variant (under its product) and by label; one column per `tierStarts`; kind shown as text + icon; reference "of base" on catalogue books and "of catalogue price" otherwise; the note linking the precedence view (FR-006, FR-007)
- [ ] T038 [P] [US2] Inheritance tests in `AT/price-book-grid.inherit.test.tsx`: an empty cell shows "inherits from {start}: value" from the nearest lower tier covering it; "not priced by this line at this quantity" when none; never zero (FR-037)
- [ ] T039 [P] [US2] Editing tests in `AT/price-book-grid.edit.test.tsx`: US2 scenarios 1–5 and 11 — bulk add of 40 products through the product picker (no duplicates), category/attribute/category∩attribute pickers offering only eligible attributes, typed values, block paste with normalisation and per-cell refusal, keyboard-only flow, bulk actions as one undo step, unsaved count, one batch on save with progress and live announcement (FR-008, FR-011–FR-013)
- [ ] T040 [P] [US2] Variant and cell-detail tests in `AT/price-book-grid.variants.test.tsx`: expand a variant product, inherited variant cells, custom window 25–49 in the detail, clear (FR-009, FR-010)
- [ ] T041 [P] [US2] Error and conflict tests in `AT/price-book-grid.errors.test.tsx`: `errors[]` with several rows marks every failing cell; `409 PRICE_BOOK_STALE` keeps the edits, reloads and offers re-apply; leaving with unsaved changes prompts; inactive and deleted-target lines show the reason (FR-014, FR-016, SC-005)
- [ ] T042 [P] [US2] Paging and search tests in `AT/price-book-grid.paging.test.tsx`: whole book loaded once (`pageSize=5000`), lines paged 50/100/200, search by name/SKU/category/attribute, kind filter, edits kept across pages; 5 000-row limit refusal before saving (FR-015)
- [ ] T043 [P] [US2] Edit-state reducer tests in `PL/admin/lib/book-edit-state.test.ts`: `data-model.md` §3 (cell keys, groups, undo/redo, save body, error mapping by `index`/`rowId`, stale re-apply)
- [ ] T044 [US2] Integration test in `backend/test/integration/price_lists/editor-batch-roundtrip.test.ts`: the save bodies the reducer builds for E1, E2 and E3 are accepted by `PUT …/rows` and the resolve endpoint returns E1.1, E2.1, E3.1

### Implementation

- [ ] T045 [US2] `PL/admin/lib/book-edit-state.ts` (reducer, save body, error mapping)
- [ ] T046 [US2] `PL/admin/components/PriceBookGrid.tsx` on the admin-kit grid (lines, columns, inherited cells, kind rendering, toolbar with add/bulk actions, search/filter, paging)
- [ ] T047 [US2] `PL/admin/components/CellDetailDialog.tsx` (custom window, inherited value, clear) on admin-kit's modal dialog
- [ ] T048 [US2] Grid tab of `PL/admin/pages/PriceBookPage.tsx` (load, save, stale flow, unsaved prompt)
- [ ] T049 [US2] i18n en + pl for every US2 string

**Checkpoint 5** — includes the UX-laws review of the grid (Hick: toolbar ≤ 5 primary actions; Von Restorff: one primary *Save*; Fitts: destructive *Clear* apart; Postel: liberal input).

---

## Phase 6: User Story 3 — Base prices on the product (P1)

**OQ-1 decides the save path.** Default (B): the panel's own *Save prices*. Alternative (A): tasks
T055a–T055c instead of T055.

### Tests first

- [ ] T050 [P] [US3] Panel tests in `AT/product-base-prices.test.tsx`: one line per currency of `targets/currencies`; tiers; variant *inherits* / fixed / ± % / ± amount with a labelled preview computed by the contracts decimal helpers (G17); "not orderable without a base price" notice; read-only when `writable` is false (controls absent); errors on fields; axe (FR-019, FR-020, FR-030)
- [ ] T051 [P] [US3] Books-on-the-product tests in `AT/product-price-books.test.tsx`: G1 list with audience and price, links to `/price-lists/:id` and `/price-lists/explain?productId=`, empty state (FR-021)
- [ ] T052 [P] [US3] Save tests in `AT/product-base-prices.save.test.tsx` — path (B): *Save prices* sends one `PUT …/base-prices/:productId`, unsaved prompt on leaving the tab or the page; path (A): the host's Save awaits the panel's flush and reports its failure (write the variant matching OQ-1)

### Implementation

- [ ] T053 [US3] `PL/admin/zones/ProductBasePrices.tsx` (panel + books list) contributed to `product.editor.pricing.after`
- [ ] T054 [US3] i18n en + pl for every US3 string
- [ ] T055 [US3] (OQ-1 = B, default) the panel's own save with `use-unsaved-changes-prompt` in `PL/admin/zones/ProductBasePrices.tsx`
- [ ] T055a [US3] (OQ-1 = A) save-participation API in `AK/zones/` (a zone registers `flush(): Promise<void>`; the host awaits all on Save) with tests in `admin/test/kit/zone-save-participation.test.tsx`
- [ ] T055b [US3] (OQ-1 = A) the catalogue product editor awaits zone flushes on Save in `packages/modules/catalog/src/admin/pages/ProductEditor.tsx`, with `admin/test/modules/catalog/ProductEditor.zone-flush.test.tsx`
- [ ] T055c [US3] (OQ-1 = A) the panel registers its flush

**Checkpoint 6.**

---

## Phase 7: User Story 4 — Duplicate (P2)

- [ ] T056 [P] [US4] Tests in `AT/price-book-duplicate.test.tsx`: pre-filled dialog (name "(copy)", channels, currency, audience, multiplier 1); changed currency flags channels before submit; multiplier explains percentages are unchanged; opens the draft copy; source untouched (FR-022)
- [ ] T057 [US4] `PL/admin/components/DuplicateDialog.tsx` and the header action; i18n en + pl

**Checkpoint 7.**

---

## Phase 8: User Story 5 — Explain a price (P2)

- [ ] T058 [P] [US5] Tests in `AT/price-explainer.test.tsx`: channel, currency, buyer (organization, customer, guest), lines; E3.1 answer 95.00 *buyer* *organization × product* with book and row links and runner-ups by name (G16); sale shows the beaten regular price; unpriced line explains and suggests a base price; pre-fill from `productId`, `variantId`, `organizationId`, `bookId`; axe (FR-023, FR-024)
- [ ] T059 [P] [US5] Entry-point tests in `AT/price-explainer-entry-points.test.tsx`: links from the book header, a grid cell, the product panel and the organization display-mode zone open the screen pre-filled (FR-024)
- [ ] T060 [US5] `PL/admin/pages/PriceExplainerPage.tsx`; links in the grid, header, product panel and `PL/admin/zones/OrganizationDisplayMode.tsx`; i18n en + pl

**Checkpoint 8.**

---

## Phase 9: User Stories 6 and 7 — Precedence view, list-price switch, storefront pair

- [ ] T061 [P] [US6] Tests in `AT/pricing-settings.precedence.test.tsx`: the page titled *Pricing settings*; preset name, twelve cells in order with an example each, category/attribute order; no control changes them; axe (FR-025)
- [ ] T062 [P] [US7] Tests in `AT/pricing-settings.list-price.test.tsx`: switch reads and writes `settings/show-list-price`, default off, write gated on `price_lists:write`, saving announced (FR-026)
- [ ] T063 [P] [US7] Storefront tests in `storefront/test/catalog/list-price-pair.test.tsx`: D1–D4 on the product page and listing card; never in the basket or checkout (FR-026, SC-007)
- [ ] T064 [US6] `PL/admin/components/PrecedenceView.tsx` in `PL/admin/pages/DisplayModeOverridesPage.tsx` (renamed *Pricing settings* in title and nav strings)
- [ ] T065 [US7] `PL/admin/components/ShowListPriceSwitch.tsx` in the same page
- [ ] T066 [US7] The pair in `storefront/components/pricing/BaseSalePriceBlock.tsx` and `storefront/components/PriceTag.tsx` from `resolvedPrice.listPrice` (G14); strings in `storefront/lib/i18n/messages.ts` (en + pl)

**Checkpoint 9.**

---

## Phase 10: User Story 8 — Representative scope across every screen (P2)

- [ ] T067 [P] [US8] Tests in `AT/price-books-rep-scope.test.tsx` (representative scoped to Acme): A3.1 editable; A3.2 the book of Acme and Beta absent from the list and its address showing the same not-found page as an unknown id; A3.3 group book read-only with edit, import, duplicate and delete controls absent; create offers only organizations in scope; explanation and filters offer only in-scope organizations; base-price panel read-only (FR-027, FR-028, SC-006)
- [ ] T068 [US8] Wire `writable`, `creatableAudienceKinds` and the not-found page through every screen (`PriceBooksPage`, `PriceBookPage`, `PriceBookCreatePage`, `PriceExplainerPage`, `ProductBasePrices`)

**Checkpoint 10.**

---

## Phase 11: User Story 9 — CSV export and import (P2)

### Tests first

- [ ] T069 [P] [US9] Codec tests in `PL/admin/lib/price-book-csv.test.ts` (`contracts/csv-format.md`): export header in en/pl, BOM, `;`, decimal comma for Polish; import of `;`/`,`, decimal comma/point, grouping space, quotes, Windows-1250 fallback, en/pl headers and kind aliases, unknown/duplicated/missing header refused, > 5 MB and > 5 000 lines refused before any request, line numbers on every local error; a 5 000-row file parses within the time recorded in the test header (FR-018, FR-038, FR-039)
- [ ] T070 [P] [US9] Import dialog tests in `AT/price-book-import.test.tsx`: US9 scenarios 1–6 — round trip yields "no changes"; preview of changed/added/refused with line numbers; replace mode lists removed rows and their count; confirm disabled while any row is refused; nothing written before confirm; confirm sends one batch with the preview's `version`; stale refusal offers a new preview; encoding choice prompt; download of refused rows with reasons; import absent while the grid holds unsaved edits and for a read-only book; axe (FR-040–FR-042)
- [ ] T071 [US9] Integration test in `backend/test/integration/price_lists/csv-import-roundtrip.test.ts`: an exported E3 book re-imported via `dryRun` gives an empty diff; a file with one change, one addition and one unknown SKU gives the expected diff and one error; confirmation writes exactly the diff (SC-009)

### Implementation

- [ ] T072 [US9] `PL/admin/lib/price-book-csv.ts` (codec)
- [ ] T073 [US9] `PL/admin/components/ImportDialog.tsx` (upload, encoding, mode, preview, refused-rows download, confirm) and the export action on `PriceBookPage`
- [ ] T074 [US9] i18n en + pl for every US9 string

**Checkpoint 11.**

---

## Phase 12: Cross-cutting and release readiness

- [ ] T075 Accessibility sweep: an axe test per route in `AT/price-books-a11y.test.tsx` (list, create, book header, grid, import dialog, duplicate dialog, explainer, pricing settings, product panel); keyboard-only walk of US1–US3 scripted in the same file (SC-003, FR-031)
- [ ] T076 [P] States sweep in `AT/price-books-states.test.tsx`: loading within 400 ms (skeleton/progress), empty, error with retry and specific copy, saving with double-submit prevented, on every screen (FR-032)
- [ ] T077 [P] Primary-action sweep in the same files: one filled primary per view, destructive actions separated and confirmed (FR-033)
- [ ] T078 [P] i18n completeness: `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts` and the admin i18n tests under `admin/test/i18n/` for every new key, en + pl; storefront keys in `storefront/test/` message tests (FR-035, SC-008)
- [ ] T079 [P] Grid performance: render-count assertions of T019 extended to 200 lines × 6 columns in `admin/test/kit/editable-grid.perf.test.tsx` (typing and focus moves re-render a bounded set of cells; a 5 000-row save yields to the event loop between stages) (FR-036)
- [ ] T080 [P] Off-state: extend `AT/price-books-surfaces.test.tsx` and the backend off-state suite (`backend/test/integration/price_lists/off-state.test.ts`) to the new routes, palette actions, pricing-tab zone and gap endpoints; run `pnpm --filter backend run check:off-state-coverage` (FR-029)
- [ ] T081 Residue: work through `checklists/residue.md` (T003) — `AppShell.tsx` comments, i18n descriptions, `price-lists-zones.test.tsx`; grep `backend/test/**`, `admin/test/**`, `storefront/test/**`, `packages/**` for every name listed; fix or delete each hit (tests that *spawn* or import a deleted path included)
- [ ] T082 Re-derive the module-removal residue ledger in `backend/test/unit/kernel/module-removal.test.ts` and any ledger derived from the touched locations, in the same commit
- [ ] T083 Regenerate: `pnpm --filter backend run composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; commit the artefacts; then `pnpm --filter backend run composer:check`, `pnpm --filter backend run manifests:check` and `pnpm --filter backend run overlay:check`
- [ ] T084 Changesets for the admin surfaces (`.changeset/161-price-lists-editor.md`, `.changeset/161-admin-kit-editable-grid.md`, `.changeset/161-storefront-list-price.md`); `pnpm --filter backend run check:release-intent`
- [ ] T085 Static estate: `pnpm run check:naming`, `pnpm run check:language`, and, each with `pnpm --filter backend run`: `check:admin-surface`, `check:admin-zones`, `check:action-route-permissions`, `check:module-boundary`, `check:platform-surface`
- [ ] T086 Full verification: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter admin run test`, `pnpm --filter storefront run test`, `pnpm --filter '!backend' run test`, `pnpm --filter backend run test` on `dev:infra:test`; report every failure with its output
- [ ] T087 Manual measurements of `quickstart.md` §3 (SC-001 walkthrough, SC-002, SC-004 wall-clock, FR-036 5 000-row save, SC-009 1 000-row preview) recorded in `plan.md` *Measurements* with the machine

**Checkpoint 12** — coordinator review of the whole feature against the spec's acceptance scenarios.

---

## Phase 13: Release-gate hand-off

- [ ] T088 Update `specs/160-pricing-model-v2/plan.md` *Release gate*: P2 complete, G11–G17 built; hand the screens' list (routes, zone, palette, settings) to feature 160 Phase 13 (FR-048 / SC-010 of spec 160 — the documentation rebuild covers these screens; nothing in `docs/` is written by this feature)
- [ ] T089 Update `specs/pricing/current-model.md` where P1 described the admin surface as "P2 pending" (working rule of `specs/conventions/pricing.md`)

## Optional block — OQ-2 = (A) saved views on the book list

- [ ] T090 [US1] (OQ-2 = A) Contract and integration tests for `price_book_list_saved_views` (feature 147 pattern) in `CT/price-book-saved-views.test.ts`
- [ ] T091 [US1] (OQ-2 = A) Table, migration (`pnpm --filter backend run migration:new`), entity, service and routes in `PL/backend/`, owned by `price_lists`
- [ ] T092 [US1] (OQ-2 = A) `SavedViewsControl` (admin-kit) on `PriceBooksPage.tsx`, with tests in `AT/price-books-saved-views.test.tsx`

---

## Dependencies

Strictly sequential by phase (owner: quality over speed). Within a phase, `[P]` tasks may run
together. Phase 2 precedes every UI phase (screens use G11–G17); Phase 3 precedes every story phase;
Phase 6's save path waits on OQ-1; T090–T092 run only if OQ-2 = (A).

## Traceability

| Requirement | Tests |
| --- | --- |
| FR-001 | T030 |
| FR-002 | T031 |
| FR-003 | T032, T005 |
| FR-004 | T032 |
| FR-005 | T030, T032 |
| FR-006 | T037, T008 |
| FR-007 | T020, T037 |
| FR-008 | T039 |
| FR-009 | T040 |
| FR-010 | T040 |
| FR-011 | T019, T039 |
| FR-012 | T039 |
| FR-013 | T039, T043 |
| FR-014 | T041, T043 |
| FR-015 | T042 |
| FR-016 | T041 |
| FR-017 | T020, T041 |
| FR-018 | T069, T071 |
| FR-019 | T050, T010 |
| FR-020 | T050, T052 (path per OQ-1) |
| FR-021 | T051 |
| FR-022 | T056 |
| FR-023 | T058, T009 |
| FR-024 | T058, T059 |
| FR-025 | T061 |
| FR-026 | T062, T063, T007 |
| FR-027 | T067, T004 |
| FR-028 | T067, T022 |
| FR-029 | T022, T023, T080 |
| FR-030 | T050, T010, T044 |
| FR-031 | T019, T075 |
| FR-032 | T030, T076 |
| FR-033 | T031, T077 |
| FR-034 | reuse is reviewed at each checkpoint; saved views per OQ-2 (T090–T092) |
| FR-035 | T078 |
| FR-036 | T019, T079 (deterministic); wall-clock in T087 |
| FR-037 | T038 |
| FR-038 | T069, T070 |
| FR-039 | T069 |
| FR-040 | T070, T071 |
| FR-041 | T070, T071 |
| FR-042 | T070 |
| SC-001 | T044 (configuration reaches the vectors); the 10-minute walkthrough is the manual measurement T087 |
| SC-002 | manual measurement T087 |
| SC-003 | T075 |
| SC-004 | T019, T079 (render bounds); wall-clock T087 |
| SC-005 | T041 |
| SC-006 | T067 |
| SC-007 | T063, T007 |
| SC-008 | T078 |
| SC-009 | T069, T070, T071; timing T087 |
