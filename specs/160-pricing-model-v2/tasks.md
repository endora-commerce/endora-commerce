# Tasks: Pricing model v2 — price books, three-tier resolution, variant prices

**Input**: `specs/160-pricing-model-v2/` — `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/`, `quickstart.md`; semantics `specs/pricing/decision-record.md` (D-287) and the vectors of
`specs/pricing/worked-examples.md` §10.

**Tests**: required — Constitution III (TDD, non-negotiable). In every phase the test tasks come
first and must fail before the implementation tasks of that phase start. Every FR and SC is traced to
a test task in *Traceability* at the end.

**Branch**: all tasks land on the release branch `feat/160-pricing-model-v2`; one pull request to
`master` after P2 and Phase 13 (`plan.md` *Release gate*).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US8 of `spec.md`; Setup, Foundational and the closing phases carry none
- Paths are repository-relative. `PL/` = `packages/modules/price_lists/src/`,
  `IT/` = `backend/test/integration/`, `WX/` = `backend/test/integration/price_lists/worked-examples/`

## Plan-phase mapping

| tasks.md phase | plan.md phase |
| --- | --- |
| 1 Setup, 2 Foundational | 1 Contracts and schema, the core of 2 |
| 3 US1, 4 US2, 5 US3, 6 US4 | 2 Resolver and precedence |
| 7 US5 | 3 Variants |
| 8 US6 | 5 Consumers, 6 Price surface |
| 9 US7 | 4 Admin API and audit |
| 10 US8, 11 Removal | 7 Conversion, removal, demo |
| 12 P2 hand-off | 8 P2 |
| 13 Documentation (gated on P2) | 9 Documentation |

---

## Phase 1: Setup

- [X] T001 `git pull --rebase` on `feat/160-pricing-model-v2`, `pnpm run build:packages`, run `pnpm --filter backend run test:unit:fast` and record the green baseline in the PR description draft (no file change)
- [X] T002 Re-measure the pre-change baselines with `PERF_RUN=true`: `backend/test/perf/price_lists/resolver.bench.ts`, `backend/test/perf/catalog/listing-price-viewer-cost.bench.ts`, `backend/test/perf/catalog/price-sort-cost.bench.ts`; write the numbers into `specs/pricing/read-paths-and-performance.md` §7 as the SC-004 baseline
- [X] T003 [P] Create the shared pricing fixture of `worked-examples.md` §10.1, §10.12 and §10.14 (channels CH/CH1–CH3, Screws/Bolts, `color` with `isPriceRule`, P1–P5 with variants P5r/P5b, VIP/Gold/Silver, Acme/Beta/Gamma/AcmeW, base books) in `backend/test/helpers/pricing-fixture.ts`, written against the new entities (fails to compile until T018)
- [X] T004 [P] Inventory every file under `backend/test/**`, `admin/test/**`, `storefront/test/**` and `packages/**/src/**/*.test.ts` that imports or spawns an artefact the plan deletes (`plan.md` *Test disposition*), and list it in `specs/160-pricing-model-v2/checklists/deletions.md` (consumed by T127)

---

## Phase 2: Foundational (blocks every story)

### Tests first

- [X] T005 [P] Contract schema tests for books, audience sets, channel sets, rows (selection kinds, `fixed`/`percent`/`amount`, −100 ≤ percent ≤ 1000, fixed on *all* refused), explanation and precedence in `packages/contracts/test/price-books.unit.test.ts` (FR-001, FR-002, FR-005, FR-006)
- [X] T006 [P] Contract test that `ChannelMemberEntityTypeSchema` accepts `price-list` in `packages/contracts/test/sales-channel-entity-types.unit.test.ts`
- [X] T007 [P] Exhaustive precedence tests in `PL/backend/services/precedence.test.ts`: generate all 924 interleavings × 2 toggles × 2 depth modes; exactly 266 accepted; each I2 violation names its pair; `nearest_organization_first` with a non-AF order refused (I5); seeded I1-breaking permutations refused; the four preset constants equal `decision-record.md` §5.6 (FR-021, FR-022)
- [X] T008 [P] Resolver unit tests in `PL/backend/services/book-resolver.test.ts`: the four tier passes, the order key (cell rank → depth → priority → min quantity → amount → ids), half-up 4-dp rounding, a negative result skipping the row and 0 as a valid price, and the property tests over all 266 configurations (the populated cell with the smallest rank wins; removing a non-winning row never changes the answer) (FR-008, FR-013–FR-015, FR-019, FR-022)
- [X] T009 [P] Profile resolution unit tests in `PL/backend/services/pricing-profile.test.ts`: vector sorting, the everyone profile, stable hash, effective group through `effectiveCustomerGroupId` (FR-010)
- [X] T010 Schema integration test in `IT/price_lists/price-books-schema.test.ts`: new tables, CHECKs (one member kind column, row selection shapes, price-type columns), FKs with cascade, unique base book per currency, precedence v1 = HY active, `sales_channel_price_lists` registered as `price-list` (FR-001, FR-009, FR-021)

### Implementation

- [X] T011 [P] Book, row, set, explanation and precedence schemas in `packages/contracts/src/price-books.ts`; export from the package barrel
- [X] T012 [P] Add `'price-list'` to `ChannelMemberEntityTypeSchema` in `packages/contracts/src/sales-channels.ts`
- [X] T013 Reshape `ListingPrice` (`source`, `compareAtAmount`, `variesByVariant`, `maxAmount`), `ListingPriceDetail`, `PricingLineResult`/`LinePriceResult` (`source`, `compareAt`) in `packages/contracts/src/price-lists.ts` and `PL/backend/services/pricing-service.interface.ts` (additive at this step; removals in T125)
- [X] T014 Scaffold the `price_lists` expand migration with `pnpm --filter backend run migration:new` in `PL/migrations/`: header columns (`currency_code` from `currency`, `audience_kind`), `price_list_audience_members`, `sales_channel_price_lists`, row columns (`variant_id`, signed `percent`, `amount` adjustment, `price_type` values), `price_list_precedence` seeded with HY, `price_profiles`, `price_profile_prices`, indexes of `data-model.md` §1–§6
- [X] T015 [P] Scaffold the `carts` migration adding `cart_items.price_source` and the entity property in `packages/modules/carts/src/backend/entities/cart-item.entity.ts`
- [X] T016 [P] Scaffold the `orders` migration adding `order_items.price_source` and the entity property in `packages/modules/orders/src/backend/entities/order-item.entity.ts`
- [X] T017 Run `pnpm --filter backend run composer:generate`, `pnpm --filter backend run manifests:generate` and `pnpm install --lockfile-only`; commit `backend/src/db/migrations-registry.generated.ts` and every regenerated artefact with T014–T016
- [X] T018 [P] Entities `PriceList` (evolved), `PriceListMatrixEntry` (evolved), `PriceListAudienceMember`, `PriceListPrecedence`, `PriceProfile`, `PriceProfilePrice` in `PL/backend/entities/`
- [X] T019 Register the `sales_channel_price_lists` bridge in `salesChannelBridgeRegistry` from `PL/backend/index.ts` (default row-less convention)
- [X] T020 [P] Presets, `validatePrecedence` and the rank table in `PL/backend/services/precedence.ts`; active-version memo per pricing generation
- [X] T021 [P] Pure three-tier resolver in `PL/backend/services/book-resolver.ts` over `matrix-decimal.ts` arithmetic
- [X] T022 [P] Profile resolution in `PL/backend/services/pricing-profile.ts` (one indexed statement, memoised per organization, group, channel and currency under the generation)

**Checkpoint**: T005–T010 green; the old model still compiles and its tests still pass.

---

## Phase 3: User Story 1 — Base prices for every product and variant (P1) 🎯 MVP

**Goal**: a buyer to whom no book applies pays the base price of the product or variant, in each
currency. **Independent test**: base books only; vectors below for a guest.

### Tests first

- [X] T023 [P] [US1] Base vectors V1, V2, V7, E1.2, E1.3 (no books), K1.3 and §10.8 Q4 in `WX/base.test.ts` on `pricing-fixture.ts` (FR-009, FR-012, FR-018)
- [X] T024 [P] [US1] Base-book write rules (one per currency, product and variant rows only, product rows fixed, variant rows fixed/percent/amount of the product's base) in `PL/backend/services/price-book-service.base.test.ts` (FR-009)
- [X] T025 [P] [US1] Base-book uniqueness and channel independence, replacing `IT/price_lists/system-price-list-singleton.test.ts`, in `IT/price_lists/base-book-singleton.test.ts`

### Implementation

- [X] T026 [US1] Base-price command (per product, all currencies, variant rows) through `CommandBus.run`, creating a currency's base book on first use, in `PL/backend/services/price-book-service.ts`
- [X] T027 [US1] Re-implement the base tier of `resolveListingPrices`, `resolveListingPriceDetails` and `resolveLinePrices` on `book-resolver.ts` in `PL/backend/services/pricing-service.ts`, keeping the P0 statement budget
- [X] T028 [US1] Remove the own-price arm (`defaultPrice`) from `PL/backend/services/listing-price-chain.ts`: an unpriced line answers `none` (FR-018) — the price-book engine's listing chain (`listingPriceFromBook`) has no own-price arm; `listing-price-chain.ts` serves only the legacy engine and goes with it (T127)

**Checkpoint**: US1 vectors green.

---

## Phase 4: User Story 2 — Organization and customer-group prices by the configured precedence (P1)

**Goal**: E2, E3 and the precedence cases under HY. **Independent test**: §10.3–§10.4, §10.10 (HY
column), §10.11.

### Tests first

- [X] T029 [P] [US2] Vectors E2.1–E2.5 and E3.1–E3.6 in `WX/buyer.test.ts` (FR-014)
- [X] T030 [P] [US2] The N11 evidence table, F1–F5, C1 and H1–H2 under **all four presets** (configured through a test-only precedence row) in `WX/precedence.test.ts` (FR-022)
- [X] T031 [P] [US2] Vectors A1.1–A1.4 and A2.1–A2.3 in `WX/audience.test.ts` (FR-002, FR-010)
- [X] T032 [P] [US2] Vectors T1–T3, §10.8 Q1–Q3, U2.1, U4 in `WX/priority-and-tiers.test.ts`; plus: renaming a book or editing a non-winning row never changes the winner (FR-045)
- [X] T033 [P] [US2] Pricing cache keyed by profile: two organizations with the same applicable books share an entry; a write bumps it, in `PL/backend/services/pricing-cache.test.ts`

### Implementation

- [X] T034 [US2] Audience-set validation (one kind, members exist, rep scope hook point) in `PL/backend/services/price-book-service.ts`
- [X] T035 [US2] Buyer tier wired into the batched entry points with the organization chain (`organizationInheritancePort`) and `effectiveCustomerGroupId` in `PL/backend/services/pricing-service.ts`
- [X] T036 [US2] Re-key `PL/backend/services/pricing-cache.ts` by `(profileId, productId, variantId, quantity)`

**Checkpoint**: US1 + US2 green.

---

## Phase 5: User Story 3 — Channel catalogue prices for everyone (P1)

**Goal**: E1 and the catalogue tier on channel sets. **Independent test**: §10.2, §10.9, §10.12, §10.13.

### Tests first

- [X] T037 [P] [US3] Vectors E1.1–E1.4, C∩0–C∩3, F2, F4, C2, U1.1–U1.3, U3.1–U3.2 in `WX/catalogue.test.ts` (FR-008, FR-013)
- [X] T038 [P] [US3] Vectors K1.1–K3.3 plus Principle XII cases (a book bound to another channel never applies; a null/unresolved channel fails closed; a currency the channel does not offer prices nothing) in `IT/price_lists/channel-set.test.ts` (FR-003, FR-011)
- [X] T039 [P] [US3] Attribute eligibility: a row on an unflagged, language-scoped, channel-scoped or free-text attribute is refused at write and inert at read; clearing the flag stops it without error, setting it resumes, in `IT/price_lists/attribute-eligibility.test.ts` (FR-007)
- [X] T040 [P] [US3] Dates at read time: a book is applied from `starts_at` and stops at `ends_at` with no sweep in between, in `IT/price_lists/applicability-dates.test.ts` (FR-011, FR-047)

### Implementation

- [X] T041 [US3] Channel-set command through `SalesChannelMembershipService.replaceChannelsForEntity` with the currency validation and dormant-binding report in `PL/backend/services/price-book-service.ts`
- [X] T042 [US3] Applicable-book query: `listEntityIdsForChannel('price-list', channelId)` memoised per generation, `k ∈ channel.currencies`, dates at read time, in `PL/backend/services/pricing-profile.ts`
- [X] T043 [US3] Catalogue tier and attribute eligibility through `catalogAttributeReadPort.listByFlag('isPriceRule')` in `PL/backend/services/pricing-service.ts`

**Checkpoint**: US1–US3 green — the P1 stories are complete on the resolver.

---

## Phase 6: User Story 4 — Sales charged only when lower (P2)

**Independent test**: §10.6 on the E3 setup.

### Tests first

- [X] T044 [P] [US4] Vectors S1.1–S1.3, S2 and U2.2 in `WX/sale.test.ts` (FR-015, FR-046)
- [X] T045 [P] [US4] A listing card carries `compareAtAmount` when a sale is charged and none when equal, in `IT/price_lists/listing-compare-at.test.ts` (FR-025)

### Implementation

- [X] T046 [US4] Sale tier and the charge rule (strictly lower, compare-at = buyer price) replacing `lineFromEngine` in `PL/backend/services/pricing-service.ts`
- [X] T047 [US4] `compareAtAmount` mapped through `ProductSummary` in `packages/modules/catalog/src/backend/services/catalog-query.service.ts` and rendered with strikethrough on the card in `storefront/components/ProductCard.tsx` / `storefront/components/PriceTag.tsx`

---

## Phase 7: User Story 5 — Variant prices (P2)

**Independent test**: §10.14.

### Tests first

- [X] T048 [P] [US5] Vectors V3–V9 in `WX/variants.test.ts` (FR-016, FR-017, FR-024, FR-031)
- [X] T049 [P] [US5] `listTierStarts` returns the starts of rows and base tiers that can apply to a product and variant, in `PL/backend/services/pricing-service.tier-starts.test.ts`
- [X] T050 [P] [US5] Storefront: the PDP shows the selected variant's resolved price and the listing card shows "from {lowest}" when variants differ, in `storefront/test/catalog/variant-price.test.tsx` (FR-024, FR-031)

### Implementation

- [X] T051 [US5] Variant rows and effective attributes (product values overlaid by the variant's axis values via `catalogProductReadPort`) in `PL/backend/services/pricing-service.ts`
- [X] T052 [US5] Listing min/max over a product's variants and `variesByVariant` in `PL/backend/services/pricing-service.ts`
- [X] T053 [US5] Rename `listBracketMinQuantities` to `listTierStarts` in `PL/backend/services/pricing-service.ts` and its caller `packages/modules/catalog/src/backend/services/catalog-org-price-decorator.ts`
- [X] T054 [US5] `GET /api/v1/storefront/products/:id/resolved-price` accepts `variantId` and returns `source`/`compareAt` in `PL/backend/routes.storefront.ts`
- [X] T055 [US5] PDP variant price and listing "from" label in `storefront/app/(catalog)/p/[slug]/page.tsx`, `storefront/components/VariantPicker.tsx`, `storefront/components/ProductCard.tsx`, with pl + en strings in the storefront message catalogue `storefront/lib/i18n/messages.ts`

---

## Phase 8: User Story 6 — One price everywhere; price sort and range on the surface (P2)

**Goal**: every surface agrees; sort and range follow the cards for every buyer; SC-005.
**Independent test**: `pricing-surfaces-agree`, `price-surface-identity`, the bench.

### Tests first

- [X] T056 [P] [US6] Rebuild `IT/price_lists/listing-prices-batch.test.ts` on `pricing-fixture.ts`: batch == single for every buyer, product and variant
- [X] T057 [P] [US6] Rebuild `IT/price_lists/line-prices-batch.test.ts` on `pricing-fixture.ts`, incl. §10.8 quantities and variant lines
- [X] T058 [P] [US6] Rebuild `IT/price_lists/customer-own-group-every-path.test.ts` on `pricing-fixture.ts` (A2 rule on listing, PDP, resolved-price, cart, quote, search) (FR-010)
- [X] T059 [P] [US6] Rebuild `IT/carts/cart-read-equals-placement.test.ts` on `pricing-fixture.ts`, incl. variant lines and equality of `price_source` (FR-030)
- [X] T060 [P] [US6] New `IT/price_lists/pricing-surfaces-agree.test.ts`: for every fixture buyer and product, listing, search hit, suggestion, PDP, comparison, product link, cart read, placement check, quote reference price, admin order preview, external order intake, external catalogue API and feed return the same amount, currency and source (FR-028, SC-002)
- [X] T061 [P] [US6] New `IT/price_lists/price-surface-identity.test.ts` replacing `unit-price-ordering.test.ts`: sort asc/desc, keyset paging and price-range membership equal the live card prices for every fixture buyer under AF, SF, HY and AF-N; a profile miss answers exactly (FR-026, SC-003)
- [X] T062 [P] [US6] Surface freshness and live-path isolation in `IT/price_lists/price-surface-refresh.test.ts`: each trigger of `contracts/price-surface.md` §4 refreshes the right profiles and bumps the generation; cart, checkout, PDP, quotes and order intake issue no statement against `price_profile_prices` (FR-027)
- [X] T063 [P] [US6] `IT/price_lists/book-statement-budget.test.ts` replacing `matrix-statement-budget.test.ts`: a 50-product page costs a constant number of statements regardless of book count (SC-004)
- [X] T064 [P] [US6] Product feeds pinned to a book read that book's rows over the catalogue price; unpriced products absent, in `IT/product_feeds/pinned-price-book.test.ts` (FR-029)
- [X] T065 [P] [US6] Organization effective price books (own, ancestor, group membership) in `IT/organizations/effective-price-books.test.ts` (FR-032)
- [X] T066 [P] [US6] Order placement copies `price_source` from the cart line in `IT/orders/order-line-price-source.test.ts` (FR-030)
- [X] T067 [P] [US6] Off-state: with `price_lists` off, the surface worker and the catalogue-event subscribers do not run and the ports refuse, in `IT/price_lists/off-state.test.ts` (Principle XVII)
- [X] T068 [US6] SC-005 bench `backend/test/perf/price_lists/price-surface.bench.ts` (fixture and assertions of `contracts/price-surface.md` §5: ≤ 150 ms p95 first and range pages for every buyer kind; ≤ 60 s refresh; storage recorded; > 10 M rows fails with a pointer to the profile-factor task)
- [X] T069 [P] [US6] Rewrite `backend/test/perf/price_lists/matrix-resolver.bench.ts` as `backend/test/perf/price_lists/book-resolver.bench.ts` (60 ms listing budget kept)

### Implementation — consumers (parallel by owner)

- [X] T070 [P] [US6] `catalog` listing, PDP, product links and home cards pass variants and render the new fields in `packages/modules/catalog/src/backend/services/catalog-query.service.ts` and `product-link.service.ts`
- [X] T071 [P] [US6] `catalog` external catalogue API on `resolveLinePrices` and `listTierStarts` in `packages/modules/catalog/src/backend/services/catalog-org-price-decorator.ts`
- [X] T072 [P] [US6] `search` hits and suggestions (suggestions now pass the request currency) in `packages/modules/search/src/backend/services/search-query.service.ts` and `suggestion-pricing-enricher.ts`
- [X] T073 [P] [US6] `comparisons` in `packages/modules/comparisons/src/backend/services/comparison-service.ts`
- [X] T074 [P] [US6] `carts`: `CartLinePricing.orderablePrices` drops the own-price step, passes `variantId`, stores `price_source`, in `packages/modules/carts/src/backend/services/cart-line-pricing.ts` and `cart-service.ts`; update `cart-line-pricing.test.ts`
- [X] T075 [P] [US6] `orders`: placement copies `price_source`; admin order preview and external order intake move to `resolveLinePrices`, in `packages/modules/orders/src/backend/routes.ts`, `services/order-service.ts`, `services/order-api-intake-service.ts`
- [X] T076 [P] [US6] `quote_requests` reference prices (request currency) in `packages/modules/quote_requests/src/backend/services/reference-price.ts`
- [X] T077 [P] [US6] `product_feeds`: `namedListPrices` semantics and generation on `resolveLinePrices` in `packages/modules/product_feeds/src/backend/plugin.ts` and `services/named-list-price-resolver.ts`
- [X] T078 [P] [US6] `PriceListReadPort.listForOrganization` in `PL/backend/services/price-list-read-port.ts`, and `organizations` re-pointed in `packages/modules/organizations/src/backend/services/organization-effective-pricelists-service.ts` (rule evaluator removed there)
- [X] T079 [P] [US6] Example overlay re-typed to the new result shapes in `backend/src/apps/example/modules/example_overlay/backend.ts`; run `pnpm --filter backend run overlay:check`

### Implementation — price surface

- [X] T080 [US6] Verify which catalogue event carries a product's category-assignment change; if none, add an additive event to `catalog`'s contract and emit it from `packages/modules/catalog/src/backend/services/category-admin.service.ts` (`research.md` R9)
- [X] T081 [US6] Verify whether a sales channel's `currencies` change is published; if not, bump the pricing generation and enqueue the affected profiles from the channel write path's lifecycle notification (`research.md` R9)
- [X] T082 [US6] Profile registry (create/retire profiles when vectors change) in `PL/backend/services/price-profile-registry.ts` — implemented inside `PL/backend/services/price-surface.ts` (`PriceSurface`), one owner for the surface
- [X] T083 [US6] Queue `price_lists.surface` and worker (atomic claim, idempotent, deduplicated keys) in `PL/backend/workers/price-surface-worker.ts`, attached with `ctx.worker` in `PL/backend/index.ts`
- [X] T084 [US6] Subscriptions to `product.*.v1`, `category.updated.v1`, `attribute.updated.v1` with generation bumps and refresh jobs, with `ctx.subscribe` in `PL/backend/index.ts`
- [X] T085 [US6] Two-stream ordering (scalar `limit 1` exclusion, watermark, keyset, range) rewriting `PL/backend/services/unit-price-ordering.ts`; `orderByUnitPrice`/`pricedProductIds` on it in `PL/backend/services/pricing-service.ts`
- [X] T086 [US6] Bounded synchronous profile-miss build for the requested restriction in `PL/backend/services/price-profile-registry.ts` — in `PL/backend/services/price-surface.ts` (live ordering over a restriction of ≤ 5 000 products)
- [X] T087 [US6] `catalog` price sort and range on the surface, the unpriced tail without a `defaultPrice` arm, in `packages/modules/catalog/src/backend/services/catalog-query.service.ts`
- [X] T088 [US6] Run the SC-005 bench (T068) and record its numbers in its header and in `specs/pricing/read-paths-and-performance.md` §7; if storage exceeds 10 M rows, add the profile-factor task (`research.md` R7) before closing the phase
- [X] T159 [US6] A request never waits on a surface build (owner decision 2026-10-22): stale profiles keep serving their previous generation until the worker swaps the rebuilt one in; a never-built profile is ordered live for a bounded restriction, from the everyone surface otherwise, or in the default order (`unordered`) when none exists, and its build is enqueued; the worker builds never-built profiles first. Tests in `IT/price_lists/price-surface-refresh.test.ts`, `price-surface-identity.test.ts`, `IT/catalog/price-sort-viewer-scope.test.ts` and the SC-005 bench; migration `price_lists_price_surface_generations`; `contracts/price-surface.md` §3

**Checkpoint**: every consumer on the new resolver; sort on the surface; SC-002–SC-005 green.

---

## Phase 9: User Story 7 — Admin price-book API, scope and audit (P2)

**Independent test**: the API as a platform administrator and as a sales representative.

### Tests first

- [X] T089 [P] [US7] Book routes (list filters, create, read, patch incl. currency immutability and audience kind after activation, activate/draftify incl. `PRICE_BOOK_NOT_APPLICABLE`, delete incl. system book 403) in `backend/test/contract/price_lists/price-books-api.test.ts` (FR-001–FR-004, FR-033)
- [X] T090 [P] [US7] Row batch upsert/delete (shape refusals, overlap with named rows, 5 000 limit, one audit entry per batch) in `backend/test/contract/price_lists/price-book-rows-api.test.ts` (FR-005, FR-006, FR-035)
- [X] T091 [P] [US7] Base-price endpoints across currencies with variant rows in `backend/test/contract/price_lists/base-prices-api.test.ts` (FR-009)
- [X] T092 [P] [US7] Duplicate with channel set, currency, audience and multiplier (half-up, percentages verbatim, draft, channel validation) in `IT/price_lists/price-book-duplicate.test.ts` (FR-036)
- [X] T093 [P] [US7] Representative scope A3.1–A3.3 and A4, and SC-008 (status code and body identical to an unknown id; lists and counts exclude) in `IT/price_lists/price-book-tenant-scope.test.ts` replacing `price-matrix-tenant-scope.test.ts` (FR-034)
- [X] T094 [P] [US7] Audit: every write of a book, row batch, channel set, member, duplicate, base price and activation writes exactly one audit entry with before/after and commits with it; nothing is audited on a refused write, in `IT/price_lists/price-book-audit.test.ts` (FR-035)
- [X] T095 [P] [US7] Explanation endpoint (tier, cell, book, row, reference, precedence version, ranked candidates; representative scope) in `backend/test/contract/price_lists/price-books-resolve.test.ts` (FR-020, FR-038)
- [X] T096 [P] [US7] Precedence: `GET` returns version 1 = HY; every write answers `409 PRECEDENCE_CHANGE_UNAVAILABLE`, in `backend/test/contract/price_lists/precedence-api.test.ts` (FR-021, FR-023)
- [X] T097 [P] [US7] Old routes gone: every path under `/api/v1/admin/price-lists-engine/`, `/api/v1/admin/pricing/rule-targets/` and `/api/v1/admin/products/:id/resolved-price` answers 404; the display-mode routes still answer, in `backend/test/contract/price_lists/removed-routes.test.ts` (FR-037)
- [X] T098 [P] [US7] Currency deletion refused while a book (base books included) uses it, in `IT/price_lists/currency-reference.test.ts` (FR-039)
- [X] T099 [P] [US7] Target pickers (eligible attributes only, channels offering a currency) in `backend/test/contract/price_lists/price-book-targets.test.ts` (FR-007, FR-003)

### Implementation

- [X] T100 [US7] Book, row-batch, member, channel-set, duplicate and activation commands with `PricingGeneration.bump()` after commit in `PL/backend/services/price-book-service.ts`
- [X] T101 [US7] Routes `/api/v1/admin/price-books/…` of `contracts/admin-price-books-api.md` in `PL/backend/routes.ts`; delete the old engine, rule-target and admin resolved-price routes
- [X] T102 [US7] Representative scope filter (organization-set books with every member in scope) in `PL/backend/services/price-book-scope.ts` — reads and writes take the request's scope; list and count filter in SQL (`visibleBookSql`)
- [X] T103 [US7] Explanation with ranked candidates in `PL/backend/services/buyer-line-price-service.ts` — the ranked candidates come from `book-resolver.ts`; `BuyerLinePriceService.resolveDetailed` carries source, compareAt and the explanation to `POST …/price-books/resolve`
- [X] T104 [US7] Base books counted by `registerPriceListCurrencyReferences` in `PL/backend/services/price-list-currency-reference.ts`
- [ ] T105 [US7] New error codes (`PRICE_BOOK_CHANNEL_CURRENCY`, `PRICE_BOOK_AUDIENCE_KIND`, `PRICE_BOOK_IMMUTABLE_FIELD`, `PRICE_BOOK_NOT_APPLICABLE`, `PRICE_BOOK_ROW_OVERLAP`, `PRICE_BOOK_ROW_SHAPE`, `PRECEDENCE_CHANGE_UNAVAILABLE`) and palette actions *Price books*, *New price book*, *Price explainer* in `PL/manifest.ts`; validation and error messages pl + en in `packages/modules/price_lists/i18n/en.json` and `pl.json` (FR-040) — **error codes, EN/PL messages and manifest declarations done; the three palette actions are not**: their targets (book list, new-book flow, explainer) are P2's screens (`specs/161-price-book-editor/` FR-029), and an action whose route does not exist yet would open a 404 — added with the screens
- [X] T106 [US7] i18n completeness: `pnpm --filter backend run check:error-translations` and the bundle tests under `backend/test/unit/_i18n/` green for every key this feature adds to `price_lists`, `catalog`, `carts` and the storefront catalogue (FR-040, SC-009)

### P2 gaps (`specs/161-price-book-editor/` *Dependencies*, G1–G10)

Added 2026-10-21 at the request of the P2 spec; each test first, then the contract
(`contracts/admin-price-books-api.md`, `data-model.md` §1) and the implementation.

- [X] T148 [US7] G1 — `GET /api/v1/admin/price-books?productId=&variantId=` answers only books with a row naming the product (variant) directly, each with `matches[]`, in `backend/test/contract/price_lists/price-books-api.test.ts` and `PL/backend/services/price-book-reads.ts`
- [X] T149 [US7] G2 — `PriceBookRow.labels` and `targetDeleted` (and `naturalKey`), batched one read per target kind, in `backend/test/contract/price_lists/price-book-rows-api.test.ts` and `PL/backend/services/price-book-reads.ts`
- [X] T150 [US7] G3 — `GET …/:id/rows?search=` over labels and SKUs, same test file and service
- [X] T151 [US7] G4 — `tierStarts` on `PriceBook` and `PriceBookSummary`, in `price-books-api.test.ts`
- [X] T152 [US7] G5 — `price_lists.version` (+ `ever_activated`) migration, `PriceBook.version`; `PATCH` and `PUT …/rows` require `expectedVersion` / `If-Match` and answer `409 PRICE_BOOK_STALE` with `details.currentVersion`, in both contract tests and `PL/backend/services/price-book-service.ts`
- [X] T153 [US7] G6 — a refused batch names every failing row (`details.errors[{index?, rowId?, field, code, message}]`), in `price-book-rows-api.test.ts` and `PL/backend/services/price-book-batch.ts` (+ `price-book-batch.test.ts`)
- [X] T154 [US7] G7 — `PUT …/rows` on a base book: product rows fixed, variant rows fixed/percent/amount, anything else refused per row, in `price-book-rows-api.test.ts`
- [X] T155 [US7] G8 — manifest setting `pricing.show_list_price` and `PUT /api/v1/admin/price-books/settings/show-list-price` through one `CommandBus.run`, in `backend/test/contract/price_lists/show-list-price.test.ts` and `PL/backend/routes.price-books.ts`
- [X] T156 [US7] G9 — `ListingPriceDetail.listPrice` and the storefront resolved price's `listPrice`, only when the setting is on and the everyone price is above the price charged (D1–D4), same test file, `PL/backend/services/book-pricing.ts`, `routes.storefront.ts`
- [X] T157 [US7] G10 — `PUT …/rows?dryRun=true` with `mode: merge | replace` and natural keys, writing nothing and answering `{version, resolved, diff, errors}`; confirmation is the same body, in `price-book-rows-api.test.ts` and `price-book-batch.ts`
- [X] T158 [US7] Re-point the consumers of the removed routes: the RFQ create prefill and the RFQ reference probe (`packages/modules/quote_requests/src/admin/`) and the display-mode page's pickers onto `/api/v1/admin/price-books/…`, with their admin tests; `rep-scope`, `rfq-handle-gate-off-state` and `permission-gates` on the new routes

---

## Phase 10: User Story 8 — The demo shows the owner's scenarios (P3)

**Independent test**: reset the demo, price E3; activate E1 alone, then E2 alone.

### Tests first

- [ ] T107 [P] [US8] Demo test in `packages/modules/price_lists/src/backend/demo/demo.test.ts`: after a reset E3's books are active and E1's and E2's are drafts; E3.1–E3.6 hold; with only E1's books active E1.1–E1.4 hold; with only E2's E2.1–E2.4 hold (FR-044, SC-007)
- [ ] T108 [P] [US8] Demo data budget unchanged in kind: `pnpm --filter backend run check:demo-data-budget` covers the new demo rows

### Implementation

- [ ] T109 [P] [US8] `price_lists` demo manifest entry and `PL/backend/demo/seed.ts`, `reset.ts`, `rows.ts`: base books for every demo product (prices carried in the step's own rows), and the E1–E3 books bound to the demo channel (E3 active, E1/E2 drafts), through the module's own services
- [ ] T110 [P] [US8] `catalog` demo: `color` flagged `isPriceRule`, a red *Screws 0200* priced through the price-lists demo rows, no `defaultPrice`, in `packages/modules/catalog/src/backend/demo/seed.ts` and `rows.ts`
- [ ] T111 [P] [US8] Customer group *VIP* seeded by its owner: a `customer_accounts` demo entry (`packages/modules/customer_accounts/src/manifest.ts`, `src/backend/demo/`)
- [ ] T112 [P] [US8] *Acme B2B (demo)* in VIP in `packages/modules/organizations/src/backend/demo/rows.ts` and `seed.ts`
- [ ] T113 [US8] `demo-composition` stops calling `DefaultPriceListMigrator` and clearing `price_list_assignments`, in `packages/demo-composition/src/composition.ts` and `demo-usage.ts`

---

## Phase 11: Conversion, removal and release readiness

**Purpose**: the one-shot conversion, the removal of the old model in `price_lists` and `catalog`, and
the repository's generated-artefact, ledger and changeset obligations.

### Tests first

- [ ] T114 [P] Conversion test in `IT/price_lists/conversion.test.ts` (`contracts/conversion-and-removal.md` §5): Default brackets in two currencies become base rows; a `defaultPrice`-only product and a variant override are **not** converted and have no price; `price_override` and the `defaultPrice`/`price` keys are gone; no non-system list; old tables absent (FR-041, FR-042, SC-006)
- [ ] T115 [P] Catalogue refusal: product and variant create, update and import refuse `defaultPrice`, `price` and `priceOverride` with `PRICE_SET_IN_PRICE_BOOKS`, in `backend/test/contract/catalog/price-fields-refused.test.ts` (FR-043)
- [ ] T116 [P] `db:fresh` + `module:install --all` on an empty database: green; the default currency's base book exists; precedence v1 = HY — in `IT/price_lists/fresh-install.test.ts`

### Implementation — conversion and catalogue removal

- [ ] T117 Scaffold the `price_lists` conversion migration with `migration:new` (steps 2–5 of `contracts/conversion-and-removal.md` §1, one transaction) in `PL/migrations/`
- [ ] T118 Scaffold the `catalog` migration dropping `product_variants.price_override` and stripping `defaultPrice`/`price` from `products.attribute_values` in `packages/modules/catalog/src/migrations/`
- [ ] T119 Remove `priceOverride` from `packages/modules/catalog/src/backend/entities/product-variant.entity.ts`, the DTOs (`routes.admin.ts`, `catalog-admin.service.ts`, `catalog-query.service.ts`, `catalog-product-read.service.ts`) and `packages/contracts/src/catalog.ts`
- [ ] T120 Remove the `defaultPrice`/`price` virtual keys (`VIRTUAL_ATTRIBUTE_VALUE_KEYS`) and add the FR-043 refusal (`PRICE_SET_IN_PRICE_BOOKS`, declared in `packages/modules/catalog/src/manifest.ts` with pl + en messages) in `packages/modules/catalog/src/backend/services/catalog-admin.service.ts` and the import mapping
- [ ] T121 Remove the *Default unit price* field and the variant price field from `packages/modules/catalog/src/admin/pages/ProductEditor.tsx` and its variant editor, with their i18n keys in `packages/modules/catalog/i18n/en.json` and `pl.json`

### Implementation — `price_lists` removal

- [ ] T122 Delete `PL/backend/entities/price-list-product.entity.ts`, `price-list-price-bracket.entity.ts`
- [ ] T123 Delete `PL/backend/services/application-rule-evaluator.ts`, `price-list-resolver.ts`, `price-list-candidate-vector.ts`, `price-bracket-resolver.ts`, `default-price-list-migration.ts`, `rule-org-targets.ts`, `matrix-price-resolver.ts` and the bracket/rule methods of `price-list-service.ts` (keep display-mode methods), with their co-located tests
- [ ] T124 Delete the old admin pages, components and zones that edit the removed model: `PL/admin/pages/PriceListsPage.tsx`, `PriceListDetailPage.tsx`, `PL/admin/components/ApplicationRuleBuilder.tsx`, `BracketGrid.tsx`, `PriceMatrixTab.tsx`, `PriceMatrixEntryDialog.tsx`, `LinkedPriceListsPanel.tsx`, `PL/admin/zones/ProductLinkedPriceLists.tsx`, `PL/admin/lib/price-matrix-api.ts`, `price-matrix-format.ts`, `roster-product-names.ts`, and `admin/test/modules/price_lists/*` except the display-mode tests, and their routes in `PL/admin/index.ts`; keep `DisplayModeOverridesPage.tsx` and the display-mode zones
- [ ] T125 Remove the Application-rule schemas, `evaluateApplicationRule`, the bracket and matrix v1 shapes from `packages/contracts/src/price-lists.ts`; confirm `packages/modules/pwa/src/backend/services/push-audience-evaluator.ts` does not import them
- [ ] T126 Delete the old integration tests listed in `plan.md` *Test disposition* (`rule-builder-normalisation`, `resolver-priority-and-tiebreak`, `price-matrix-resolution`, `price-matrix-lifecycle`, `price-matrix-surfaces`, `bracket-pricing-end-to-end`, `default-seed-and-migration`, `system-price-list-singleton`, `listing-price-per-organization`, `unit-price-ordering`, `matrix-statement-budget`, `price-matrix-tenant-scope`, `sale-special-price`, `inherited-price-list`) from `IT/price_lists/`

### Repository obligations (`AGENTS.md`, *The traps*)

- [ ] T127 Grep `backend/test/**`, `admin/test/**`, `storefront/test/**` and `packages/**` for every deleted file and symbol of T119–T126 (against `checklists/deletions.md` of T004); fix or delete each hit, including tests that *spawn* a deleted script — `test:unit:fast` does not reach the contract and integration trees
- [ ] T128 Re-derive the module-removal residue ledger in `backend/test/unit/kernel/module-removal.test.ts` (and any ledger derived from the deleted files' locations) in the same commit as the deletions
- [ ] T129 Run `pnpm --filter backend run composer:generate`, `pnpm --filter backend run manifests:generate` and `pnpm install --lockfile-only`; commit `backend/src/db/migrations-registry.generated.ts`, the regenerated module reference (`docs/docs/module-reference/*`), sidebars and package manifests; confirm `pnpm install --frozen-lockfile` and `overlay:check` pass
- [ ] T130 Changesets (`minor` — the breaking level in 0.x, D-225) in `.changeset/160-*.md` for `@endora-commerce/contracts`, `@endora-commerce/mod-price-lists`, `mod-catalog`, `mod-carts`, `mod-orders`, `mod-organizations`, `mod-product-feeds`, `mod-search`, `mod-comparisons`, `mod-quote-requests`, each body giving the old call and the new one (removed routes and their replacements; reshaped result types; removed catalogue fields); `pnpm --filter backend run check:release-intent` green
- [ ] T131 Run the static estate: `pnpm run check:naming`, `pnpm run check:language`, and `pnpm --filter backend run` `check:module-boundary`, `check:platform-surface`, `check:command-coverage` (every new write on the Command Bus), `check:off-state-coverage`, `check:queue-names`, `check:subscribe-seam`, `check:admin-surface`, `check:action-route-permissions`, `composer:check`, `manifests:check`; plus `pnpm --filter backend exec vitest run test/unit/db/fk-dependency-drift.test.ts test/unit/db/module-graph.test.ts`; re-record a read size only where its band refuses (`specs/conventions/check-estate.md`)
- [ ] T132 Rewrite `specs/pricing/current-model.md` to describe the shipped model and refresh the *Verified against* lines of the files re-checked (working rule of `specs/conventions/pricing.md`)
- [ ] T133 Full verification: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter backend run test` (unit + contract + integration on `dev:infra:test`), `pnpm --filter '!backend' run test`; report every failure with its output

---

## Phase 12: P2 hand-off (the release is gated on P2)

- [ ] T134 Verify each item of `plan.md` *What P1 leaves ready for P2* against a test (T089–T099 for the API, T005 for the exported types, T105 for i18n and palette actions, T124 for the empty admin surface, T107 for demo data) and mark it in `plan.md`
- [ ] T135 Export every price-book schema and type the editor needs from `packages/contracts/src/index.ts` (books, rows, batch, base prices, explanation with candidates, targets, precedence read) and assert the exports in `packages/contracts/test/price-books.unit.test.ts`
- [ ] T136 Validate `specs/160-pricing-model-v2/quickstart.md` end to end on a fresh database (commands, the E3 explanation call) and fix any drift in it
- [ ] T137 Open the P2 specification (`/speckit.specify`, the price-book editor, issue #378 re-scoped) from this release branch; record its number and branch in `plan.md` *Release gate*. The `master` pull request is opened only after P2's acceptance and Phase 13 pass

---

## Phase 13: Documentation rebuild (FR-048, SC-010) — ⛔ GATED ON P2

**Runs only after P2 is complete, on the release branch.** English and Polish through
`docs/docs/contributing/documentation-i18n.md`.

### Checks first

- [ ] T138 Add the SC-010 search as a docs test in `backend/test/unit/docs/pricing-removed-mechanisms.test.ts`: no page under `docs/docs/**`, `docs/i18n/pl/**` or `packages/modules/*/docs/**` mentions the Application rule, the product *default price* or the variant price override except in a section marked as history or migration note (SC-010)

### Rewrite

- [ ] T139 [P] Rewrite `packages/modules/price_lists/docs/price_lists.md` (user and developer content of `plan.md` *Phase 9*), including E1–E3 and the precedence presets
- [ ] T140 [P] Catalogue pages: `packages/modules/catalog/docs/catalog/attributes.md` and the catalogue page (*Price list rules*, no *Default unit price*, variant prices in price books; listing pricing and price sort for developers)
- [ ] T141 [P] `packages/modules/carts/docs/carts.md` (what a line is charged; `orderablePrices`, `price_source`)
- [ ] T142 [P] `packages/modules/organizations/docs/organizations.md` and `organization-hierarchy.md` (effective price books, chain depth)
- [ ] T143 [P] `packages/modules/quote_requests/docs/quote_requests.md`, `packages/modules/search/docs/search.md`, `packages/modules/product_feeds/docs/product_feeds.md`, `packages/modules/quick_order/docs/quick_order.md` and the orders page
- [ ] T144 [P] Site pages naming price lists: `docs/docs/integrations/api-access.md`, `docs/docs/architecture/tenant-scoping.md`, `docs/docs/intro.md` and any page T138 reports
- [ ] T145 Polish translations of every page of T139–T144 through the manual workflow; refresh the translation cache; `pnpm --filter backend run check:docs-translations` green
- [ ] T146 Regenerate the module reference (`composer:generate`) and run `pnpm --filter backend run check:module-docs` and `pnpm --filter docs run build`; T138 green (FR-048, SC-010)
- [ ] T147 Refresh `specs/pricing/read-paths-and-performance.md` with the final measurements and update `specs/conventions/pricing.md` working rules that still describe the old model (the batched entry points, the cache key, the identity-test names)

---

## Dependencies & execution order

- **Setup (1)** → **Foundational (2)** → stories.
- **US1 → US2 → US3** in order (each tier builds on the previous one in `pricing-service.ts`); their
  test tasks can all be written in parallel once Phase 2 is done.
- **US4 (sale)** and **US5 (variants)** depend on US3; they are independent of each other.
- **US6** depends on US1–US5 (consumers need the final result shapes; the surface needs every tier).
- **US7** depends on US1–US3 (commands) and can run alongside US6.
- **US8** depends on US7 (books written through the services) and on T110–T113's owners.
- **Phase 11** depends on US6 and US7 (nothing may still read the old tables) and US8 (the demo must
  not need `DefaultPriceListMigrator`).
- **Phase 12** after Phase 11. **Phase 13** only after P2.

## Parallel examples

- Phase 2 tests: T005, T006, T007, T008, T009 together.
- US2 tests: T029, T030, T031, T032, T033 together.
- US6 consumers: T070–T079 together (one owner each), after T056–T067 are written.
- US7 tests: T089–T099 together.
- Docs: T139–T144 together, then T145.

## Implementation strategy

MVP = Phases 1–5 (base, buyer and catalogue tiers on the resolver, behind the old consumers' seams):
every E1–E3 vector passes in the integration suites. Then sale and variants, then consumers and the
surface (the SC-005 gate), then the API, the demo and the removal. Nothing reaches `master` before P2
and Phase 13 (`plan.md` *Release gate*).

## Traceability

| Requirement | Test tasks |
| --- | --- |
| FR-001 | T005, T010, T089 |
| FR-002 | T005, T031, T093 |
| FR-003 | T038, T099 |
| FR-004 | T089 |
| FR-005 | T005, T010, T090 |
| FR-006 | T005, T090 |
| FR-007 | T039, T099 |
| FR-008 | T008, T037 |
| FR-009 | T010, T023, T024, T091 |
| FR-010 | T009, T031, T058 |
| FR-011 | T038, T040 |
| FR-012 | T023 |
| FR-013 | T008, T037 |
| FR-014 | T008, T029 |
| FR-015 | T008, T044 |
| FR-016 | T048 |
| FR-017 | T048 |
| FR-018 | T023 |
| FR-019 | T008 |
| FR-020 | T095 |
| FR-021 | T007, T010, T096 |
| FR-022 | T007, T008, T030 |
| FR-023 | T096 |
| FR-024 | T048, T050 |
| FR-025 | T045 |
| FR-026 | T061 |
| FR-027 | T062 |
| FR-028 | T060 |
| FR-029 | T064 |
| FR-030 | T059, T066 |
| FR-031 | T048, T050 |
| FR-032 | T065 |
| FR-033 | T089 |
| FR-034 | T093 |
| FR-035 | T090, T094 |
| FR-036 | T092 |
| FR-037 | T097 (routes); T130 `check:release-intent` (changesets) |
| FR-038 | T095 |
| FR-039 | T098 |
| FR-040 | T106 |
| FR-041 | T114 |
| FR-042 | T114 |
| FR-043 | T115 |
| FR-044 | T107 |
| FR-045 | T032 |
| FR-046 | T044 |
| FR-047 | T040 |
| FR-048 | T138, T145, T146 (absence and translation are tested; content completeness is reviewed) |
| SC-001 | T023, T029–T032, T037, T044, T048 |
| SC-002 | T060 |
| SC-003 | T061 |
| SC-004 | T002 (baseline), T063, T069 |
| SC-005 | T068, T088 |
| SC-006 | T114 |
| SC-007 | T107 |
| SC-008 | T093 |
| SC-009 | T106 |
| SC-010 | T138, T146 |
