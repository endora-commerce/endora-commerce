# Contract — Price resolution v2 (FR-010–FR-020, FR-028–FR-031)

Normative for `PL/backend/services/pricing-service.ts` and its pure helpers. The algorithm is
`specs/pricing/decision-record.md` §5.2 verbatim; this contract fixes the **seams** consumers and
overlays see. What P0 shipped (`research.md` R1) is kept unless a row below says otherwise.

## 1. Entry points (names kept)

| Method (on `PricingServiceContract`) | Status | Change |
| --- | --- | --- |
| `resolveListingPrices(input)` | **kept, only listing path** | products may carry `variantIds` (all variants of a variant product are resolved when absent); result `ListingPrice` gains `source`, `compareAtAmount?`, `variesByVariant`, `maxAmount` |
| `resolveListingPriceDetails(input)` | kept | the base/sale split becomes `{ base, catalogue, buyer, sale }` amounts as available, plus `ListingPrice` |
| `resolveLinePrices(input)` | **kept, only line path** | each line may carry `variantId`; result `PricingLineResult` gains `source`, `compareAt?`, `explanation` (internal); `isSale` stays (= `source === 'sale'`) |
| `resolveEngine`, `resolveLinePrice` | kept as wrappers over the batch of one | result shape follows the batch; overlays decorating them must decorate the batch too (unchanged rule) |
| `orderByUnitPrice`, `pricedProductIds`, `pageDisplayMode` (`ListingPriceOrderPort`) | kept | served from the price surface (`price-surface.md`) |
| `namedListPrices` | kept | FR-029: that book's rows over the catalogue price (the channel's, without the pinned book), on the feed's channel and currency; products it does not price are absent; **nothing at all** while the book does not publish (owner ruling 2026-10-23, `research.md` R18) |
| `namedListPublishability` | **new** | FR-029, owner ruling 2026-10-23: `{ publishable: true }` while the book is `active`/`scheduled` inside its window, bound to the feed's channel (a base book is channel-independent) and for everyone; otherwise `{ publishable: false, reason }` with `reason ∈ pinnedPriceBookUnpublishableReasonSchema` |
| `listBracketMinQuantities` | **renamed `listTierStarts`** | distinct `min_quantity` of rows and base tiers that can apply to `(product, variant?, channel, currency)`; the ladder probe keeps calling `resolveLinePrices` |

Published ports in `@endora-commerce/contracts` (`ListingPricePort`, `ListingPriceDetailPort`,
`LinePricesPort`, `ListingPriceOrderPort`, `OrgLinePricePort`, `BuyerLinePricePort`) keep their
names; their result types change as above (a `minor` changeset).

## 2. Inputs

The buyer is **named, not resolved by the caller** (P0 rule, `specs/conventions/pricing.md`):
`organization` (+ chain resolved by the engine through `organizationInheritancePort`) and
`customerAccountId`; the engine applies `effectiveCustomerGroupId`. `salesChannel` and
`currencyCode` (default: the channel's default currency). A currency the channel does not offer →
every line unpriced (FR-011, K3.2), never an error.

## 3. Statement budget (kept from P0)

Per batch, independent of the number of products/lines: the applicable books (one statement,
memoised per profile and generation), their rows for the page (one), base rows for the page (one),
catalogue facts (category assignments, variants with axis values, eligible attributes — the existing
catalogue ports, one call each, only when a row needs them), display modes (unchanged). Asserted by
a statement-counting test replacing `matrix-statement-budget.test.ts`.

## 4. Cache

`PricingCache` key: `(profileId, productId, variantId, quantity)` (profile carries channel, currency
and precedence version). Invalidation: `PricingGeneration.bump()` after commit — every price-book
write, a sweep that flips a status, every catalogue event of `research.md` R9, a channel currency
change, a surface refresh. TTL 60 s stays the bound when a bump is lost.

## 5. Consumers re-pointed (FR-028)

| Consumer | Today (after P0) | P1 |
| --- | --- | --- |
| `catalog` listing, PDP, product links, home cards | `resolveListingPrices` / `…Details` | same calls; pass variants; render `from`/compare-at fields through `ProductSummary` |
| `catalog` price sort / range (`#listByViewerPrice`, `#listWithPriceRange`) | candidate-vector merge | the surface (`price-surface.md`); the unpriced tail no longer has a `defaultPrice` arm |
| `catalog` external catalogue API | `resolveLinePrices` | same; tier ladder via `listTierStarts` |
| `search` hits and suggestions | `resolveListingPrices` / `…Details` | same; suggestions pass the request currency (closes a P0-open item) |
| `comparisons` | `resolveListingPrices` | same |
| `carts` (`CartLinePricing.orderablePrices`: read, add, merge, quantity, placement check) | `resolveLinePrices` + own-price fallback | same call with `variantId`; **own-price step removed**; store `source` as `cart_items.price_source` |
| `orders` placement, admin order preview, external order intake probe | placement via carts; preview and intake per line | placement copies `price_source`; preview and intake move to `resolveLinePrices` (closes P0-open N+1) |
| `quote_requests` reference prices (`BuyerLinePricePort`) | `resolveLinePrices` | same; currency from the request (the quote-line half of #303 stays out of scope) |
| `product_feeds` | `namedListPrices`; per-item `resolveLinePrice` | `namedListPrices` (FR-029); generation moves to `resolveLinePrices` (closes P0-open N+1) |
| `organizations` effective price lists | `evaluateApplicationRule` over `PriceListReadPort` | `PriceListReadPort.listForOrganization(orgId)` (new method): books whose members include the org or an ancestor, or its group |
| storefront PDP, variant picker | listing details; no per-variant price | resolved price of the selected variant (`resolved-price?variantId=`) and the listing's `from` price |
| `backend/src/apps/example/modules/example_overlay` | decorates single + batch | re-typed to the new result shapes |

## 6. Identity obligations

| Test | Asserts |
| --- | --- |
| `backend/test/integration/price_lists/listing-prices-batch.test.ts` (rewritten fixture: `worked-examples.md` §10.1 + §10.14) | batch == single, product by product, every buyer of the fixture |
| `…/line-prices-batch.test.ts` | batch == one `resolveLinePrice` per key, incl. variants and quantities of §10.8 |
| `…/unit-price-ordering.test.ts` → **`price-surface-identity.test.ts`** | surface order and range == live card prices, every buyer, under AF, SF, HY, AF-N |
| `backend/test/integration/carts/cart-read-equals-placement.test.ts` | cart read == placement, incl. variant lines and `price_source` |
| `…/customer-own-group-every-path.test.ts` | the effective-group rule on every surface (A2.1–A2.3) |
| new `worked-examples.test.ts` | every §10 vector belonging to P1 (SC-001) |
| new `pricing-surfaces-agree.test.ts` | SC-002: every FR-028 surface returns the same amount, currency and source |
