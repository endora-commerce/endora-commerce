# Contract — Backend gaps G11–G19 (built in feature 161)

The admin API of feature 160 is the contract (`specs/160-pricing-model-v2/contracts/admin-price-books-api.md`,
implemented in `packages/modules/price_lists/src/backend/routes.price-books.ts`, schemas in
`packages/contracts/src/price-books.ts`). G1–G10 are implemented by 160. These nine were found while
planning against the code (`research.md` R1; G18 after the coordinator's review of 2026-10-22; G19 and the G15 redesign after the bench of 2026-10-22); each is **additive** (no field removed, no route
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

## G15 — page the grid by line, within 150 ms p95 at 50 000 lines

**Endpoint (unchanged since the first implementation):**
`GET /api/v1/admin/price-books/:id/lines?page=1&pageSize=100&kind=…&search=…` → `{ data:
PriceBookLine[], meta: { page, pageSize, totalLines } }`, a line carrying **all** its rows and a
product line its variant lines, ordered general → specific, page numbers (`research.md` R2).

**Read design (redesign of 2026-10-22, `research.md` R14):**

| Owner | Piece |
| --- | --- |
| `catalog` | IMMUTABLE SQL functions `catalog_admin_display_name(name jsonb, sku text, lang text)` and `catalog_admin_name_key(…)`; generated stored columns `products.admin_name_key_<lang>` (collation `"C"`) and `products.admin_search_key_<lang>` for `lang ∈ {en, pl}`; btree `products_admin_order_<lang> (admin_name_key_<lang>, sku, id) include (admin_search_key_<lang>)`; GIN trigram on `admin_search_key_<lang>` and on `lower(product_variants.sku)`; `create extension if not exists pg_trgm` |
| `catalog` | `CatalogProductReadPort.pageProductsByAdminName({ membership: { sql, params }, language, search?, offset, limit }) → { ids, total }` replacing `pageProductIdsByName` |
| `price_lists` | `price_list_product_lines (price_list_id, product_id)` — PK, FKs `on delete cascade` to `price_lists` and `products`; maintained in the batch write, base-price write and duplicate transactions; backfilled by its migration; row-less lines reconciled on catalogue events |
| `price_lists` | `priceBookMembership(bookId) → { sql, params }` — the only SQL of one module that runs inside the other's statement (precedent `CustomFieldListFilterPort.condition`) |
| `price_lists` | the lines read: visibility-only header; small kinds; `totalLines` = line-table count (no search) or the port's `total` (search); page ids from the port; rows and labels for the page only |

**Name rule** (`catalog_admin_display_name`): for admin language `L`, the non-empty name with the
alphabetically first tag whose primary subtag is `L`; else the same for `en`; else the first non-empty
name by tag; else the SKU. Key: that name case- and accent-folded (NFKD without combining marks;
`ł→l`, `đ→d`, `ø→o`, `ß→s`, `æ→a`), bytewise order, ties by SKU then id. Equal to `pickName` for every
name read from the database (T025).

**Search**: `like '%term%'` on `admin_search_key_<lang>` (folded the same way) or a variant SKU; the
catalogue counts once, then pages from the trigram hits when `total ≤ 2 000`, else by the ordered
walk.

**Measured (prototype, `research.md` R14)**: p95 of the DB side ≤ 36 ms for first, middle and last
page and ≤ 83 ms for every search case at 50 001 lines; the bench T029 asserts ≤ 150 ms p95 end to end
for every case.

Tests: T024–T029 (rule, parity, port, line table, reworked contract and statement tests, bench); the
original T008/T009 assertions are kept.

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

## G19 — the list price on search-backed listings

| Where | Change |
| --- | --- |
| `packages/contracts/src/search.ts` | the search listing summary's `resolvedPrice` and the suggestion item gain `listPrice?: { amount, currency }` |
| `packages/modules/search/src/backend/services/search-query.service.ts` | maps `ListingPriceDetail.listPrice` into `ProductSummary.resolvedPrice` |
| `packages/modules/search/src/backend/services/suggestion-pricing-enricher.ts` | maps it onto suggestion items |

Whether it is present stays P1's decision (`listPriceOf`). Test:
`backend/test/integration/search/list-price-in-search.test.ts` — D1–D4 on the search listing and the
suggestions (T030).

