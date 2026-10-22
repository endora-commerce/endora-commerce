# Deletions checklist — feature 160 (T004, consumed by T127)

Every test file that imports, names or spawns an artefact `plan.md` deletes (*Test disposition*,
*Removal*), with what happens to it. Derived on 2026-10-21 by grepping `backend/test/**`,
`admin/test/**`, `storefront/test/**` and `packages/**/src/**/*.test.ts*` for the deleted entities
(`PriceListProduct`, `PriceListPriceBracket`), services (`PriceListService`,
`DefaultPriceListMigrator`, `application-rule-evaluator`, `price-list-resolver`,
`price-list-candidate-vector`, `price-bracket-resolver`, `matrix-price-resolver`,
`rule-org-targets`), routes (`/price-lists-engine`, `/pricing/rule-targets`) and admin screens
(`PriceListsPage`, `PriceListDetailPage`, `ApplicationRuleBuilder`, `BracketGrid`, `PriceMatrixTab`,
`PriceMatrixEntryDialog`, `LinkedPriceListsPanel`, `ProductLinkedPriceLists`, `price-matrix-api`,
`price-matrix-format`, `roster-product-names`).

Re-derive before T127 rather than trusting this list — the command is the grep above; a file
added after today is not here.

## Done in Phase 8 (engine switch)

Replaced or deleted in the same commit as the switch:

- [X] `backend/test/integration/price_lists/unit-price-ordering.test.ts` → `price-surface-identity.test.ts`
- [X] `backend/test/integration/price_lists/matrix-statement-budget.test.ts` → `book-statement-budget.test.ts`
- [X] `backend/test/integration/price_lists/sale-special-price.test.ts` → S vectors of `worked-examples/`
- [X] `backend/test/integration/price_lists/price-matrix-resolution.test.ts` (deleted)
- [X] `backend/test/integration/price_lists/price-matrix-surfaces.test.ts` (deleted)
- [X] `backend/test/perf/price_lists/matrix-resolver.bench.ts` → `book-resolver.bench.ts`

Fixtures re-pointed to price books (`helpers/price-book-sql.ts`, `helpers/pricing-fixture.ts`) and
no longer naming a deleted artefact: `helpers/price-sort-fixture.ts`,
`helpers/two-channel-basket-fixture.ts`, `helpers/viewer-priced-fixture.ts`,
`helpers/seed-product-feeds.ts`, `contract/price_lists/admin-resolved-price.test.ts`,
`contract/organizations/applicable-price-lists.test.ts`, `contract/catalog/external-reads.test.ts`,
`contract/catalog/api-key-tenant-isolation.test.ts`, `contract/catalog/bulk-pricing-parity.test.ts`,
`contract/orders/external-intake.test.ts`, `integration/catalog/link-tile-price-source.test.ts`,
`integration/catalog/listing-name-sort-paging.test.ts`,
`integration/catalog/listing-price-source.test.ts`, `integration/catalog/price-sort-visibility.test.ts`,
`integration/comparisons/comparison-price-source.integration.test.ts`,
`integration/price_lists/line-prices-batch.test.ts`,
`integration/price_lists/listing-prices-batch.test.ts`,
`integration/product_feeds/channel-isolation.test.ts`, `integration/product_feeds/generation.test.ts`.

## Deleted with the code they test (T127)

Backend:

- [ ] `backend/test/integration/price_lists/rule-builder-normalisation.test.ts`
- [ ] `backend/test/integration/price_lists/resolver-priority-and-tiebreak.test.ts`
- [X] `backend/test/integration/price_lists/price-matrix-lifecycle.test.ts`
- [ ] `backend/test/integration/price_lists/bracket-pricing-end-to-end.test.ts`
- [ ] `backend/test/integration/price_lists/default-seed-and-migration.test.ts`
- [ ] `backend/test/integration/price_lists/listing-price-per-organization.test.ts` (A vectors)
- [X] `backend/test/contract/price_lists/price-lists-engine.test.ts` (route removed in Phase 9)
- [X] `backend/test/contract/price_lists/price-list-products.test.ts` (route removed in Phase 9)
- [X] `backend/test/contract/price_lists/price-list-products-bulk-add.test.ts` (route removed in Phase 9)
- [X] `backend/test/contract/price_lists/price-matrix-entries.test.ts` (route removed in Phase 9)
- [X] `backend/test/contract/price_lists/rule-targets.test.ts` (route removed in Phase 9)
- [ ] `backend/test/unit/price_lists/legacy-default-price-key.audit.test.ts` (the audited chain goes)
- [X] `backend/test/unit/price_lists/price-list-audit-emissions.test.ts` → re-asserted on the
      price-book commands, or deleted with `PriceListService`

Package unit tests of deleted services:

- [ ] `packages/modules/price_lists/src/backend/services/application-rule-evaluator.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/candidate-vector.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/matrix-entry-rules.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/matrix-price-resolver.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/price-bracket-resolver.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/price-list-resolver.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/bulk-add-partition.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/listing-price-chain.test.ts`
- [ ] `packages/modules/price_lists/src/admin/lib/price-matrix-format.test.ts`

Admin (`admin/test/modules/price_lists/*` per *Test disposition*, plus the screens' neighbours):

- [ ] `admin/test/modules/price_lists/LinkedPriceListsPanel.test.tsx`
- [ ] `admin/test/modules/price_lists/PriceListProducts.bulk-add.test.tsx`
- [ ] `admin/test/modules/price_lists/price-lists-zones.test.tsx`
- [ ] `admin/test/modules/price_lists/PriceMatrixTab.test.tsx`
- [ ] `admin/test/modules/price_lists/roster-product-names.test.ts`
- [ ] `admin/test/modules/batch-thirteen-surfaces.module-owned-surface.test.tsx` — drop the
      price-list screens from its roster (edit, not delete)
- [ ] `admin/test/modules/catalog/ProductEditor.channels-tab.test.tsx` — drop the
      `LinkedPriceListsPanel` expectation (edit, not delete)

Also deleted in Phase 9 with the routes they covered: `backend/test/contract/price_lists/admin-resolved-price.test.ts`
(the probe; `price-books-resolve.test.ts` replaces it).

## Re-pointed to price books (fixture rebuilt, T127 or earlier)

They seed through `DefaultPriceListMigrator`, `PriceListService` or the bracket entities and
assert behaviour that survives the model; each moves to `helpers/price-book-sql.ts` /
`helpers/pricing-fixture.ts`.

- [ ] `backend/test/helpers/package-entities.ts` — drop the two entity re-exports
- [ ] `backend/test/helpers/price-book-sql.ts` — `ensureBaseBookSql` stops writing the legacy
      `Default` shape; `seedDefaultBracketSql` goes
- [ ] `backend/test/helpers/price-list-neighbour-ports.ts` (deleted once nothing constructs `PriceListService`)
- [ ] `backend/test/helpers/orders-neighbour-ports.ts`
- [ ] `backend/test/helpers/rich-listing-corpus.ts`
- [ ] `backend/test/helpers/tiered-product-fixture.ts`
- [ ] `backend/test/contract/carts/cart-conversions.contract.test.ts`
- [ ] `backend/test/contract/orders/admin-order-preview-availability.test.ts`
- [X] `backend/test/contract/price_lists/permission-gates.test.ts` (gates of the new routes)
- [ ] `backend/test/contract/price_lists/pricing-resolution.test.ts`
- [X] `backend/test/contract/price_lists/product-pricing-panel.test.ts` — deleted with the route in Phase 9 (G1 replaces it)
- [ ] `backend/test/fixtures/openapi-baseline.json` (regenerated after the route change)
- [ ] `backend/test/integration/carts/cart-line-refusal-codes.test.ts`
- [ ] `backend/test/integration/catalog/listing-price-batching.test.ts`
- [ ] `backend/test/integration/catalog/price-sort-withheld.test.ts`
- [ ] `backend/test/integration/comparisons/viewer-priced-share.integration.test.ts` (entity imports only)
- [ ] `backend/test/integration/customers/customer-group-pricing.test.ts`
- [ ] `backend/test/integration/kernel/cross-process-invalidation.test.ts`
- [ ] `backend/test/integration/organizations/flat-behavior-preserved.test.ts`
- [ ] `backend/test/integration/price_lists/absent-owner-refuses.test.ts`
- [ ] `backend/test/integration/price_lists/display-mode-chain.test.ts`
- [ ] `backend/test/integration/price_lists/inherited-price-list.test.ts` → H and A vectors
- [X] `backend/test/integration/price_lists/price-matrix-tenant-scope.test.ts` → `price-book-tenant-scope`
- [ ] `backend/test/integration/price_lists/pricing-invalidation-after-commit.test.ts`
- [ ] `backend/test/integration/price_lists/status-lifecycle.test.ts`
- [ ] `backend/test/integration/product_feeds/image-urls-are-absolute.test.ts`
- [ ] `backend/test/integration/product_feeds/run-diagnostics.test.ts`
- [ ] `backend/test/integration/quote_requests/line-carry-over.test.ts`
- [ ] `backend/test/integration/quote_requests/reference-price.test.ts`
- [X] `backend/test/integration/tenancy/price-lists.cross-tenant.test.ts` — deleted in Phase 9; the representative scope of books is `price-book-tenant-scope.test.ts`
- [ ] `backend/test/perf/catalog/listing-price-cost.bench.ts`
- [ ] `backend/test/perf/catalog/listing-price-viewer-cost.bench.ts`
- [ ] `backend/test/perf/price_lists/resolver.bench.ts` (superseded by `book-resolver.bench.ts`; delete or re-point)
- [ ] `backend/test/unit/price_lists/price-list-status-worker.test.ts`
- [ ] `packages/modules/price_lists/src/backend/services/category-membership-port.test.ts`

## Derived, not named

- [ ] `backend/test/unit/kernel/module-removal.test.ts` — the residue ledger names
      `DefaultPriceListMigrator`; re-derive its entries in the commit that deletes the migrator
      (AGENTS.md trap: the batch that frees an entry cannot see it go stale).
