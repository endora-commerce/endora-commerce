# Contract — Backend gaps G11–G18 (built in feature 161)

The admin API of feature 160 is the contract (`specs/160-pricing-model-v2/contracts/admin-price-books-api.md`,
implemented in `packages/modules/price_lists/src/backend/routes.price-books.ts`, schemas in
`packages/contracts/src/price-books.ts`). G1–G10 are implemented by 160. These eight were found while
planning against the code (`research.md` R1; G18 after the coordinator's review of 2026-10-22); each is **additive** (no field removed, no route
renamed) and is built test-first in Phase 2 of `tasks.md`, before any screen depends on it. Each
needs a `minor` changeset on the package it changes (`specs/conventions/release-intent.md`, D-225).

## G11 — writability for the caller

| Where | Change |
| --- | --- |
| `priceBookSchema`, `priceBookSummarySchema` | `writable: boolean` — `bookWritable(currentPriceBookScope(), book)` (`services/price-book-scope.ts`) |
| `priceBookListResponseSchema.meta` | `creatableAudienceKinds: PriceBookAudienceKind[]` — every kind for which `audienceKindWritable` holds |
| `productBasePricesSchema` | `writable: boolean` — `bookWritable` of the base book (false for a sales representative) |

Test: `backend/test/contract/price_lists/price-books-writable.test.ts` — platform admin `true`
everywhere; representative scoped to {Acme}: `true` on {Acme}, `false` on everyone/group books and
base prices, `creatableAudienceKinds = ['organizations']`.

## G12 — label stored organization members

`GET /api/v1/admin/price-books/targets/organizations?ids=<uuid>,<uuid>` (≤ 1 000 ids, the member cap)
→ `{ data: { items: [{ id, name, taxId }] } }`, scope-filtered exactly as the search; an id outside
the scope or unknown is absent (never an error that reveals existence). `search` and `ids` are
mutually exclusive (`400` otherwise).

Test: `backend/test/contract/price_lists/price-book-targets-ids.test.ts`.

## G13 — audit-log deep link

`packages/modules/audit_logs/src/admin/pages/AuditLogViewer.tsx` initialises its `objectType`,
`objectId` and `action` filters from the URL query and writes them back on change, so
`/audit-log?objectType=price_list&objectId=<id>` opens the book's history. Owned by `audit_logs`.

Test: `admin/test/modules/audit_logs/audit-log-viewer-url-filters.test.tsx`.

## G14 — list price reaches the catalogue DTOs

| Where | Change |
| --- | --- |
| `productResolvedPriceSchema` (`packages/contracts/src/price-lists.ts`) | `listPrice: { amount, currency }` optional |
| `ProductSummary` (`packages/contracts/src/catalog.ts`) | carries `resolvedPrice.listPrice` on listing pages as well as on the product detail |
| `packages/modules/catalog/src/backend/services/catalog-query.service.ts` | maps `ListingPriceDetail.listPrice` into both |

Whether it is present stays P1's decision (`listPriceOf`: setting on and catalogue above buyer).
Test: `backend/test/integration/catalog/list-price-in-summaries.test.ts` (vectors D1–D4 of
`specs/pricing/worked-examples.md` §10.15 on the listing and detail responses).

## G15 — page the grid by line, at a cost independent of the book

`GET /api/v1/admin/price-books/:id/lines?page=1&pageSize=100&kind=…&search=…`

- `pageSize`: lines, 50/100/200 offered by the UI, maximum 500. `kind`: one or more selection kinds
  (a `variant` filter returns product lines that carry matching variant lines).
- Answer `{ data: PriceBookLine[], meta: { page, pageSize, totalLines } }` with
  `PriceBookLine = { selectionKey, selectionKind, selection, labels, naturalKey, inactiveReason,
  targetDeleted, rows: PriceBookRow[], variants?: PriceBookLine[] }` — **every** row of the line,
  never a part; a product line carries its variant lines (a product with only variant rows still gets
  a product line, with `rows: []`).
- Order: `all`, attribute values, categories, category ∩ attribute values, products (variants nested),
  by label within a kind (FR-006).
- Cost per call, independent of the book's size except for one index-only scan of ids:
  1. distinct selections of the book by kind with counts, from `price_list_matrix_entries`
     (`price_list_id`, selection columns) — no labels;
  2. the page is cut in that order; attribute and category kinds (few) are labelled in full; the
     product segment is ordered and searched by the catalogue through
     **`catalogProductReadPort.pageProductIdsByName({ ids, search?, language, offset, limit })` →
     `{ ids, total }`** (new, owned by `catalog`; `order by` localized name, SKU, id);
  3. rows and labels only for the page's lines.
- The row endpoint (`GET …/:id/rows`) is unchanged; export reads it page by page.

Tests:
- `backend/test/contract/price_lists/price-book-lines.test.ts` — a base book of 1 200 products with 1–4
  tiers each and variants on 100 of them, `pageSize=100`: no line split across pages (every line's
  rows equal the stored rows of that selection), variants on their product's page, `totalLines`
  correct, pages concatenate to every line exactly once in order; `search` and `kind` filters.
- `backend/test/contract/price_lists/price-book-lines-statements.test.ts` — the statement count of a
  page call is the same for a 300-line and a 30 000-line book.
- `backend/test/perf/price_lists/book-lines-page.bench.ts` (`PERF_RUN=true`) — p95 of a 100-line page
  at a 50 000-line base book, first and last page, with and without search; budget **150 ms p95**
  (the platform's listing-page budget of SC-005 of spec 160), asserted; measurement recorded in the
  header.
- `packages/modules/catalog` — unit/integration test of `pageProductIdsByName` (order, search,
  offset, language fallback) in `backend/test/integration/catalog/page-product-ids-by-name.test.ts`.

## G16 — name the runner-ups

`priceBookExplanationCandidateSchema` gains `bookName: string` and `labels: PriceBookRowLabels`,
resolved in the same batch as the winner's (`services/buyer-line-price-service.ts`).

Test: extend `backend/test/contract/price_lists/price-books-resolve.test.ts` with E3.1: candidates
named *Acme contract* (category *Screws*) and *VIP prices* (product *Screws 0200*).

## G18 — batch writes read only what they validate; base books uncapped

- `PriceBookService.writeRows` (and its `dryRun`) loads the stored rows of the **selections the batch
  touches** (overlap is per selection), the book's row **count**, and, in `replace` mode, the ids of
  every stored row (index-only) — not every row with its labels.
- `PRICE_BOOK_MAX_ROWS` (5 000) applies to non-base books only; base books are bounded by the
  catalogue (FR-009 of spec 160). `PRICE_BOOK_MAX_ROWS_PER_BATCH` (5 000) is unchanged for every book.

Tests: `backend/test/contract/price_lists/price-book-batch-scope.test.ts` — a base book of 6 000 rows
accepts a batch; a non-base book is refused at 5 001; statement count of a 10-row batch is the same for
a 300-row and a 30 000-row book; replace mode on a large base book still lists every removed row in
the dry run.

## G17 — one decimal implementation for server and browser

Move `parseUnits`, `formatUnits`, `parseSignedUnits`, `parseSignedPercentHundredths`,
`applySignedPercent`, `applyAmountAdjustment`, `normaliseAmount`, `compareDecimal` from
`packages/modules/price_lists/src/backend/services/matrix-decimal.ts` to
`packages/contracts/src/price-book-decimal.ts` (exported from the barrel); `matrix-decimal.ts`
re-exports them, so the resolver's imports do not change.

Test: move `matrix-decimal.test.ts`'s cases to `packages/contracts/test/price-book-decimal.unit.test.ts`;
keep a re-export identity test in the module.
