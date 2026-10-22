# Contract — Backend gaps G11–G17 (built in feature 161)

The admin API of feature 160 is the contract (`specs/160-pricing-model-v2/contracts/admin-price-books-api.md`,
implemented in `packages/modules/price_lists/src/backend/routes.price-books.ts`, schemas in
`packages/contracts/src/price-books.ts`). G1–G10 are implemented by 160. These seven were found while
planning against the code (`research.md` R1); each is **additive** (no field removed, no route
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

## G15 — load a whole book in one request

`priceBookRowsQuerySchema.pageSize` maximum raised from 1 000 to `PRICE_BOOK_MAX_ROWS` (5 000).
Nothing else changes; the read already labels the whole book per call.

Test: `backend/test/contract/price_lists/price-book-rows-page-size.test.ts` — 5 000 rows in one
response; the response time of a 5 000-row book recorded in the test's header (measured, not a
loosened budget) and asserted below 2 s on the CI runner's recorded baseline.

## G16 — name the runner-ups

`priceBookExplanationCandidateSchema` gains `bookName: string` and `labels: PriceBookRowLabels`,
resolved in the same batch as the winner's (`services/buyer-line-price-service.ts`).

Test: extend `backend/test/contract/price_lists/price-books-resolve.test.ts` with E3.1: candidates
named *Acme contract* (category *Screws*) and *VIP prices* (product *Screws 0200*).

## G17 — one decimal implementation for server and browser

Move `parseUnits`, `formatUnits`, `parseSignedUnits`, `parseSignedPercentHundredths`,
`applySignedPercent`, `applyAmountAdjustment`, `normaliseAmount`, `compareDecimal` from
`packages/modules/price_lists/src/backend/services/matrix-decimal.ts` to
`packages/contracts/src/price-book-decimal.ts` (exported from the barrel); `matrix-decimal.ts`
re-exports them, so the resolver's imports do not change.

Test: move `matrix-decimal.test.ts`'s cases to `packages/contracts/test/price-book-decimal.unit.test.ts`;
keep a re-export identity test in the module.
