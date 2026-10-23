# Pricing — read paths and performance

Every place a price is **read** — listings, PDP, search, typeahead, cart, checkout, quotes, promotions — with its entry point, query shape, caching, measured cost and remaining defects. The current read paths come first; the summary and the detailed audit of the pre-160 baseline follow.

**Verified against** the release branch at `e1758312e` (feature 160 with its editor, feature 161)
on 2026-10-23 for *Current read paths*, *Still open* and §7, and re-checked at `91e8c1907` the same
day after the targeted surface refresh and the T165/T173 measurements. The detailed audit below them (§0–§6,
§8) describes the **pre-160** read paths — the Application-rule engine, the Default-list brackets
and the feature-086 ordering — and is kept unchanged as the baseline the price-book model was
measured against: its file:line citations name code that no longer exists, and every path it
lists now resolves through the batched price-book entry points (`current-model.md` §1.2).

**Section numbers.** `§N` references follow the numbering of the original analysis, which is split across this directory: §1 → `current-model.md`; §2 → `read-paths-and-performance.md` (its summary table); §3–§9, §11, §12 → `decision-record.md`; §10 → `worked-examples.md`. `read-paths §N` points into `read-paths-and-performance.md`, `peers §N` into `peer-platforms.md`. Path abbreviations: `PL/` = `packages/modules/price_lists/src/`, `CON/` = `packages/contracts/src/`, `CAT/` = `packages/modules/catalog/src/`, `SF/` = `storefront/`.

---

## Current read paths (after feature 160)

Every path prices through one of the batched entry points of `PL/backend/services/pricing-service.ts`
(`resolveListingPrices`, `resolveListingPriceDetails`, `resolveLinePrices`) or reads the price
surface; a batch costs a constant number of statements whatever the number of products, lines or
books. Measurements are in §7.

| Path | Entry point | Cost | Held by |
| --- | --- | --- | --- |
| Listing page, 50 cards (catalogue, home cards, product links) | `resolveListingPrices` / `…Details`, variants ranged | constant statements per page (≤ 15 asserted); `book-resolver.bench.ts` 50-product page p95 11.1–13.0 ms (budget 60) | `IT/price_lists/book-statement-budget.test.ts`, `listing-prices-batch.test.ts` |
| Product page | the listing details of the product; the selected variant through `resolved-price?variantId=` | one resolution per page, one more for a selected variant | `customer-own-group-every-path.test.ts`, `storefront/test/catalog/single-price-resolution.test.tsx` |
| Search hits and typeahead | `resolveListingPriceDetails` per page / popup; the typeahead passes the request currency (open after P0, closed by 160) | one batch | `packages/modules/search/src/backend/services/cross-module-ports.test.ts` |
| Price-sorted and price-range page | `orderByUnitPrice` / `pricedProductIds` over the price surface — a two-stream merge | first page p95 ≤ 28.2 ms at 50 000 products (T133), ≤ 27.4 ms at 202 built profiles; a single change visible in the order after 0.20–0.49 s at 202 profiles (targeted refresh, 2026-10-23) | `IT/price_lists/price-surface-identity.test.ts`, `price-surface-refresh.test.ts`, `perf/price_lists/price-surface.bench.ts` |
| Cart read, add, merge, quantity change, placement check | `resolveLinePrices` inside `CartLinePricing.orderablePrices`, with each line's `variantId` | one batch per basket | `IT/carts/cart-read-equals-placement.test.ts`, `IT/price_lists/line-prices-batch.test.ts` |
| Admin order preview, external order intake | `resolveLinePrices` (one per request — the N+1 P0 left open, closed by 160) | one batch | `IT/price_lists/pricing-surfaces-agree.test.ts` |
| Product feed generation and the criteria count | `resolveLinePrices` per batch as a guest; `namedListPrices` for a pinned book, empty while `namedListPublishability` says the book does not apply (closed by 160) | one batch per 500 items | `pricing-surfaces-agree.test.ts` |
| Quote reference prices | `BuyerLinePricePort.resolveForBuyer`, request currency | one batch per 100-line chunk | `PL/backend/services/buyer-line-price-service.test.ts` |
| External catalogue API (list, detail, bulk prices) | `resolveLinePrices`; the tier ladder from `listTierStarts` | one batch per call | `backend/test/contract/catalog/bulk-pricing-parity.test.ts` |
| Admin price explainer | `POST /api/v1/admin/price-books/resolve` → `BuyerLinePriceService.resolveDetailed` | one batch, ≤ 200 lines | `backend/test/contract/price_lists/price-books-resolve.test.ts` |
| Admin price grid page | `GET /api/v1/admin/price-books/:id/lines` | p95 ≤ 125.3 ms on a 50 003-line book, steady state (161 G15) | `perf/price_lists/book-lines-page.bench.ts` |
| CSV import preview and save | `PUT …/rows?dryRun=true`, then `PUT …/rows` | 5 000 rows: preview 205 ms, commit 1 024 ms; 1 000 rows: 83 ms file to preview | `perf/price_lists/editor-import-save.bench.ts` |

## Still open

- The **external catalogue API** prices the bound organization with its group; the API key's bound
  customer account's own group is not passed.
- **Next.js `pricing:*` cache tags** are never revalidated by the backend (§2.4).
- **Short price-sorted and search pages** (#235, §3).
- Issues **#167** and the quote-line half of **#303** (§8).
- The **display-mode settings write** is not on the Command Bus (pre-existing,
  `PL/backend/services/price-list-service.ts`).
- **A change that concerns every product of its profiles still rebuilds them whole** — a row
  selecting by attribute alone or every product, a change to more than 10 000 products, a channel
  event, the precedence. A full rebuild of 202 profiles took 274.7 s (§7); SC-005's 60 s is
  measured for targeted changes only, not for this case. (Until 2026-10-23 every bump rebuilt every
  profile; the targeted refresh of research R17 replaced that.)

## Summary of the pre-160 baseline

| Path | Cost (cold) | Notes |
| --- | --- | --- |
| Listing page, 50 cards (`resolveListingPrices`) | 14–15 statements, p95 ≈ 22 ms on 120 products | batched; CPU O(products × active lists); `listing-price-viewer-cost.bench.ts:43-68` |
| Same with matrix entries | p95 11–15 ms on 2 000 products | `backend/test/perf/price_lists/matrix-resolver.bench.ts:37-45` |
| `resolveEngine` (`resolved-price` route, a single cart add) | ≈ 7 statements (+1 account read for a signed-in customer); p95 8.5–11 ms, 50 lists | `backend/test/perf/price_lists/resolver.bench.ts:39-46`; the PDP no longer calls it (read-paths §2.1) |
| `resolveLinePrices` (cart read, placement check, quote reference, external API) | **12 statements for 9 lines and for 45 lines**, against 112 for one `resolveLinePrice` per line | `backend/test/integration/price_lists/line-prices-batch.test.ts` (asserted constant, ≤ 16) |
| Price-sorted first page | 3.1 ms no matrix; 41.4 ms category %; 21.3 ms all-products % (2 000 products) | merge of index streams (`PL/backend/services/unit-price-ordering.ts:1-41`) |
| Search (Meilisearch) | index carries **no price**; hits re-priced from Postgres; price sort/range routed to Postgres | `packages/modules/search/src/backend/services/search-query.service.ts:78-84, 262-291` |
| N+1 survivors | admin order preview, external order intake probe, product feed generation | read-paths §2.3, §5; the five paths P0 batched are listed in *P0 — what changed* below |

Not measured anywhere: > 5 000 products on the listing path, hundreds of org-targeted lists,
category-heavy rules, multi-replica cache behaviour under load (read-paths §7).

---

## P0 — what changed (D-287 P0, read-path hardening)

The model is unchanged; these are the read-path defects of the audit below that P0 fixed. Each
names the test that holds it.

| Defect (audit §) | Now | Test |
| --- | --- | --- |
| PDP priced twice (§2.1) | `GET /api/v1/catalog/products/:slug` carries `ProductSummary.resolvedPrice` (base, sale, display mode) from the resolution behind `price` (`resolveListingPriceDetails`); the storefront PDP no longer calls `resolved-price` | `backend/test/integration/price_lists/customer-own-group-every-path.test.ts` (one details call, no `resolveEngine`); `storefront/test/catalog/single-price-resolution.test.tsx` |
| Home bestsellers N+1 HTTP (§2.1) | the cards read the listing's `resolvedPrice`; `getResolvedPricesBulk` is removed | `single-price-resolution.test.tsx` |
| Typeahead `resolveEngine` per hit (§4) | one `resolveListingPriceDetails` call per popup | `packages/modules/search/src/backend/services/cross-module-ports.test.ts` |
| External catalogue API per summary / line / rung (§2.1) | one `resolveLinePrices` call each | `backend/test/contract/catalog/bulk-pricing-parity.test.ts` |
| Cart GET recompute, batch add, login/reorder reprice, placement drift check per line (§5) | one `resolveLinePrices` call per basket (`CartLinePricing.orderablePrices`) | `packages/modules/carts/src/backend/services/cart-line-pricing.test.ts`, `backend/test/integration/carts/cart-pricing-recompute.integration.test.ts` |
| Quote reference prices per line (§5) | one `resolveLinePrices` call per 100-line chunk | `packages/modules/price_lists/src/backend/services/buyer-line-price-service.test.ts` |
| Customer's own group ignored on listings, PDP, cart (§2.2) | one rule on every path, price sort included (`current-model.md` §1.2) | `customer-own-group-every-path.test.ts`, `line-prices-batch.test.ts` |
| Invalidate before commit (§2.4) | after `CommandBus.run` returns, only for a write that mutated; a fill that straddles an invalidation is not stored | `backend/test/integration/price_lists/pricing-invalidation-after-commit.test.ts` |
| No cross-process invalidation (§2.4) | bump published on `b2b:price_lists:pricing-generation`, every process subscribes on boot | `backend/test/integration/kernel/cross-process-invalidation.test.ts` |
| Sweeper does not invalidate (§2.4) | a sweep that flips a list bumps | `pricing-invalidation-after-commit.test.ts` |
| Cart own-price fallback labelled PLN (§1) | labelled with the basket channel's default currency; a basket with no channel is unpriced for it | `cart-line-pricing.test.ts` |
| `GET /cart` re-priced on a second chain — #168 (§5) | the read prices through `CartLinePricing.orderablePrices`, the chain placement's drift check runs: agreed price, own-price fallback and display-mode refusal included; a line placement would refuse reads as unavailable | `backend/test/integration/carts/cart-read-equals-placement.test.ts` |
| Variant picker shows `price_override` (§1) | no price per variant; the PDP price block is the price of every variant | `storefront/test/catalog/variant-picker.test.tsx` |

Still open after P0 (not fixed, by decision or scope):
- **N+1**: admin order preview (`orders/src/backend/routes.ts`, `resolveLinePrice` per line), the
  external order intake probe (`order-api-intake-service.ts`), product feed generation
  (`product_feeds/src/backend/plugin.ts`, one `resolveLinePrice` per item).
- The external catalogue API prices the bound **organization** only; the API key's bound customer
  account is not passed, so that customer's own group does not apply there.
- The typeahead passes **no currency** (prices in the channel default).
- Next.js `pricing:*` cache tags are still never revalidated by the backend (§2.4).
- Catalog writes (categories, `defaultPrice`) still do not invalidate the pricing cache (§2.4).
- Short price-sorted and search pages (#235, §3).
- Issues #167 and the quote-line half of #303 (§8).

## Detailed audit (pre-160 baseline)

Read-only audit. "Inferred" marks a conclusion drawn from code that was not executed or measured.

## 0. The data model in one paragraph

| Table | Role | Key / indexes |
| --- | --- | --- |
| `price_lists` | header: `type base|sale`, `status draft|active|scheduled|expired`, `starts_at/ends_at`, `application_rule` JSONB, `is_system`, `modified_at`; legacy `code/currency/priority/is_default` still present | `PL/migrations/20260426T075235…:24-38`, engine cols `20260504T125655…:44-91`; `status`, `type`, `modified_at` idx (`…engine.ts:80-92`); singleton `is_system` partial unique (`20260817T055457…:49-51`) |
| `price_list_products` | (list, product) assignment | PK `(price_list_id, product_id)`, idx `product_id` (`…engine.ts:97-111`) |
| `price_list_price_brackets` | the actual price: per (list, product, currency, min_qty) with `max_quantity`, `amount numeric(14,4)` | PK `(price_list_id, product_id, currency_code, min_quantity)`, FK to assignment (`…engine.ts:117-138`); partial covering `(price_list_id, currency_code, amount, product_id) where min_quantity = 1` (`20260821T135907…:37-45`). **No index leading with `product_id`.** No variant column. |
| `price_list_matrix_entries` (feature 148) | rule-based rows: product / category / attribute / all × optional org × qty window × fixed or %-off | `20261016T131148…:26-87`, 5 indexes (`:73-87`) |
| `price_display_mode_overrides` | gross/net/both/none per org/category/product | PK `(scope, target_id)` (`…engine.ts:143-156`) |
| `price_list_items`, `price_list_assignments` | feature-014 legacy tables, still created, not read by the engine (inferred: no reference in `PL/backend/services/pricing-service.ts`) | `20260426T075235…:41-82` |

Rule targeting (org / customer group / category / sales channel / currency) lives **inside
`application_rule` JSONB**, not in columns (`20260817T055457…:14-18`). So "which lists apply to
this buyer" cannot be answered by an index — every resolution loads **all active lists** and
evaluates every rule in memory (`PL/backend/services/pricing-service.ts:440-455`, `:664-694`,
`:993-1004`).

Priority (`PL/backend/services/price-list-resolver.ts:7-16, 27-57`): org (nearest in the org
inheritance chain) → customer group → category → sales channel → anything else (Default lives
here); tie-break newest `modifiedAt`, then name. The legacy `priority` column is ignored by the
engine (only `PriceListReadService.listAll/listActive` order by it, `price-list-read-port.ts:39-55`).
Sale partition wins whenever it resolves anything (`pricing-service.ts:88-110`).

---

## 1. Base price — where it lives, and is it guaranteed?

**There are two sources of a base price, and neither is guaranteed.**

1. **System `Default` price list** — deterministic id `00000000-0000-4000-8000-00000000d51b`,
   `is_system = true`, `application_rule {kind:'all'}`, seeded by
   `PL/migrations/20260504T125655_price_lists_engine.ts:167-218` and
   `PL/backend/services/default-price-list-migration.ts:22, 47-60`. DB-enforced singleton since
   `20260817T055457…:38-52`; cannot be deleted (`price-list-service.ts:338-343`), cannot leave
   `active` or narrow its rule (`price-list-service.ts:360, 379`). Its brackets are the
   platform's intended catalogue price.
2. **`products.attribute_values.defaultPrice` (fallback `price`)** — a bare number, no currency,
   **still edited by the admin Product editor** (`CAT/admin/pages/ProductEditor.tsx:267-278`) and
   whitelisted as a "virtual attribute" (`CAT/backend/services/catalog-admin.service.ts:114-125`).

The migration copied (2) into (1) **once** (`…engine.ts:226-301`: identity-copy per channel
currency, fallback PLN). Nothing keeps them in sync afterwards: `price_lists` has no event
subscriber and no product-create hook (grep of `PL/backend` for `subscribe|eventBus|product.created`
returns nothing). So a product created or re-priced in the Product editor after the migration has
**no Default-list bracket** unless an operator adds one in the price-list editor.

Consequences:
- The listing chain is *"applicable list → product's own `defaultPrice` → nothing"*
  (`PL/backend/services/listing-price-chain.ts:7-11, 24-53`). The own-price arm applies only when
  the requested currency equals the channel default (`:49`).
- The cart applies the same fallback. Until P0 it labelled it **hard-coded `PLN`**; since P0 it
  labels it with the basket channel's default currency, as the listing chain does, and a basket
  whose channel is gone is unpriced for it (`CartLinePricing.orderablePrices`). The cart prices in
  the channel default only, so the listing's "requested currency equals channel default" guard has
  no cart counterpart to disagree with.
- The storefront variant picker showed `product_variants.price_override`, which is never charged;
  since P0 it shows no price per variant (`SF/components/VariantPicker.tsx`).
- Price-sort and price-range ignore the own-price arm entirely; those products go to the
  "unpriced tail" (`CAT/backend/services/catalog-query.service.ts:949-959`).
- Variant prices do not exist: brackets have no `variant_id` (`…engine.ts:117-138`); `variantId`
  is only part of the cache key (`pricing-service.ts:410-418`), never a lookup dimension. (Issue
  #377 asks for variant prices.)
- Guarantee: **no** — not every product has a Default bracket, and not every product has a
  `defaultPrice`. "No price" is a first-class answer (`source: 'none'`).

---

## 2. Storefront PLP / category / PDP — endpoints, buyer context, round trips, caching

### 2.1 Which endpoints the storefront calls

| Surface | Storefront code | Backend endpoint | Price resolution |
| --- | --- | --- | --- |
| Category page `/c/[slug]`, `/catalog`, `/search` | `SF/app/(catalog)/c/[slug]/page.tsx:82`, `SF/app/(catalog)/catalog/page.tsx:49`, `SF/app/(catalog)/search/page.tsx:49` → `SF/lib/api/catalog.ts:82-110` | `GET /api/v1/catalog/products` | batched `resolveListingPrices` (qty 1) |
| PLP card | `SF/components/ProductGrid.tsx:43` renders `<ProductCard>` **without** `resolved` | — | uses `ProductSummary.price` = `{amount,currency}` only (`packages/contracts/src/price-lists.ts:540-546`) → **no sale/strikethrough, no display-mode on PLP cards** |
| Home "bestsellers" | `SF/app/page.tsx` | `GET /api/v1/catalog/products?limit=4` | **P0:** the cards render the listing's `ProductSummary.resolvedPrice`; the per-card `resolved-price` fan-out (`getResolvedPricesBulk`) is gone |
| PDP `/p/[slug]` | `SF/app/(catalog)/p/[slug]/page.tsx` | `GET /api/v1/catalog/products/:slug` | **P0:** priced **once**, by `resolveListingPriceDetails([product])` in `CatalogQueryService.getProductByIdOrSlug`; the page renders `product.resolvedPrice` and no longer calls `resolved-price` (it priced the product a second time through `resolveEngine`). PDP passes no `variantId`. |
| Cart page | `SF/app/(commerce)/cart/page.tsx:152` | `GET /api/v1/storefront/pricing/display-mode/:productId` (first item only) | display-mode chain |
| Typeahead | `SF/components/SearchAutocomplete.tsx:346-355` | `GET /api/v1/search/suggest` | **P0:** one `resolveListingPriceDetails` call for the popup (see §4) |
| External catalog API (`/api/v1/external/catalog/*`) | n/a (B2B integrations) | `CAT/backend/services/catalog-org-price-decorator.ts` | **P0:** one `resolveLinePrices` call each for the summaries, the bulk lines and the tier ladder (it was one sequential `resolveLinePrice` per summary, line and rung) |

### 2.2 Buyer context

- **Organization**: from the session's `ProductAudience.organizationId`, loaded through
  `OrganizationDetailsPort` once per page (`CAT/backend/services/catalog-query.service.ts:533-544`;
  storefront routes `PL/backend/routes.storefront.ts:60-74`). Org inheritance chain via
  `organizationInheritancePort.priceListOrgChain` (`PL/backend/index.ts:142-143`).
- **Customer group** (P0): one rule on every path — explicit group ?? the customer account's own
  group ?? the organization's (`effectiveCustomerGroupId`, `PL/backend/services/customer-group-rule.ts`).
  Callers name the buyer: `productAudienceOf` carries `customerAccountId`, and the listing, the
  product detail, product links, search, the typeahead, comparisons, the `resolved-price` route
  and the cart pass it; the engine reads the account once per call (one statement) and ignores an
  account of another organization. The price **ordering** (`orderByUnitPrice`, `pricedProductIds`)
  applies the same rule, so the sort and the card agree. `BuyerLinePriceService` and the admin
  order preview pass the group they resolved. Before P0 listings, the PDP endpoint and the cart
  used the organization's group alone, so one buyer could meet different winners on PLP vs. quote.
- **Sales channel**: resolved once by middleware (`getResolvedChannel`, `routes.storefront.ts:125, 166`).
  A non-public channel skips pricing entirely (`catalog-query.service.ts:516`).
- **Currency**: `?currency=` from the `currency` cookie (`SF/lib/api/catalog.ts:39-43`), normalised
  to "omit if equal to channel default" (`packages/contracts/src/price-lists.ts:775-785`). The cart
  and the typeahead ignore it: the cart prices in the basket channel's default currency, the
  typeahead passes no currency (still open after P0).

### 2.3 Query cost per listing page (`resolveListingPrices`, `PL/backend/services/pricing-service.ts:616-757`)

Batched — one call for the whole page (`catalog-query.service.ts:735-749`). Statements on a cold
cache, independent of page size except where noted:

1. category memberships for the page, one `in(...)` via catalog port (`:654`, `:337-347`);
2. org chain, if signed in (`:658-663`);
3. **all active price lists** (`:664`), each row carrying a correlated `exists()` on matrix entries
   (`PL/backend/entities/price-list.entity.ts:90-94`);
4. per product, in memory: evaluate every active list's rule (`:668-694`) — **O(products × active lists)** CPU;
5. matrix entries for matched lists, 0–1 statement (+1 attribute read if an entry names an
   attribute) (`:231-272`, `:701-714`);
6. brackets in **priority waves** — one `price_list_id in(…) and product_id in(…)` statement per
   fall-through level per partition (`:1268-1354`); normally 1 for base, 0–1 for sale; +1 for
   Default brackets when a %-matrix entry needs a reference (`:278-291`);
7. display modes for the page (`:729-735`, `price-list-service.ts:1190+`).

The method's own header records the history: the previous per-product loop was **7 sequential
queries per product — 350 round trips / 315 ms for a 50-card page** (`pricing-service.ts:575-583`).
Measured after batching: a 50-card page cold = **14 statements, 61.9 ms anon / 15 statements,
32.1 ms signed-in; p95 22 ms** (`backend/test/perf/catalog/listing-price-viewer-cost.bench.ts:43-68`;
corpus only 120 products, no categories — `:70-82`).

The same walk now backs two more batched entry points (P0): `resolveListingPriceDetails` (the
listing answer plus base / sale / display mode) and `resolveLinePrices` (many lines, each at its own
quantity; one walk item per distinct product × variant × quantity). Measured for
`resolveLinePrices`: **9 lines = 12 statements, 45 lines = 12 statements, against 112 for one
`resolveLinePrice` per line** (`backend/test/integration/price_lists/line-prices-batch.test.ts`).
A signed-in customer adds one account read per call.

Per-product, non-batched paths still in production use (cache-miss cost ≈ 7 statements each,
sequential):
- The `resolved-price` route → `resolveEngine` (1 product, fine; no catalogue surface calls it
  since P0), and a single cart add or quantity change (a batch of one).
- Admin order preview — `resolveLinePrice` per line (`orders/src/backend/routes.ts`).
- External order intake probe (`order-api-intake-service.ts`).
- Product feed generation — `resolveLinePrice` per item (`product_feeds/src/backend/plugin.ts`).
- `resolveEngine` additionally **constructs a new `PriceListService` per call** via dynamic import
  to resolve display mode (`pricing-service.ts:491-504`) — 1–4 more statements
  (`price-list-service.ts:1070-1125`).

### 2.4 Caching

| Layer | Where | Key | TTL | Invalidation |
| --- | --- | --- | --- | --- |
| **`PricingCache` — in-process LRU, not Redis** | `PL/backend/services/pricing-cache.ts`, one instance per process (`PL/backend/plugin.ts`) | `(productId, variantId, quantity, currency, salesChannelId, organizationId, effective customerGroupId)` | 60 s, capacity 5 000; tests use 0 (`PL/backend/index.ts`) | **P0:** through `PricingGeneration` (`PL/backend/services/pricing-generation.ts`): every audited `PriceListService` write (matrix writes included) after `CommandBus.run` returns, and only when it mutated; every status sweep that flips a list; each bump clears the local LRU and is published on Redis `b2b:price_lists:pricing-generation`, which every process subscribes to on boot. A fill whose resolution began before a bump is not stored (generation counter). |
| cart recompute | Redis `b2b:cart:recompute:<cartId>` (`packages/modules/carts/src/backend/services/cart-recompute-cache.ts:20-21`) | cartId | 30 s | `invalidate(cartId)` on cart writes (`:77-80`); hit check is by cartItemId only, not quantity (`cart-pricing-recompute.ts:176-179`) |
| Next Data Cache (storefront) | `SF/lib/api/client.ts:120-156` | URL (+channel/lang headers) | 60 s, **anonymous only**; signed-in = `no-store` | tags `pricing:resolved`, `pricing:product:<id>`, `catalog:products` (`SF/lib/api/pricing.ts:95, 159`, `SF/lib/api/catalog.ts:108`) — **no backend code posts these tags** (grep of `packages`/`backend/src` for them is empty; the shared tag vocabulary covers only CMS/megamenu, `packages/contracts/src/storefront-cache-tags.ts:20-38`) |
| HTTP | backend sets `Cache-Control: private, no-store` for org-bound responses (`markPersonalisedPricing`, `routes.storefront.ts:112, 156`) | | | |

Fixed by P0 (kept for the record): multi-process staleness (a write cleared only the writer's
process), the scheduler not invalidating, and the invalidate-before-commit race. The cross-process
bump is best effort: a lost message degrades to the 60 s TTL, the pre-P0 behaviour. A scheduled
list still goes live up to one sweep interval (5 min) after its `startsAt`, since activation is
the sweep's, not read-time.

Gaps still open (code-verified unless marked):
- **Catalog-side writes do not invalidate**: category membership (drives category rules and display
  mode) and `defaultPrice` (own-price arm) are written by `catalog`, which never touches the pricing
  cache (grep).
- **Worst-case anonymous staleness ≈ 60 s Next + 60 s backend LRU** (inferred from both TTLs, no tag
  revalidation).
- **Hit rate collapses for B2B**: 99.0 % anonymous vs **5.3 % at 50 organizations**
  (`listing-price-viewer-cost.bench.ts:24-27`) because `organizationId` is in the key even when the
  org's winning list is the same as everyone's.

---

## 3. Sort by price / price range on listings

- Route: `CAT/backend/routes.public.ts:219-226` refuses a price sort when the page shows no prices;
  any price sort or range **forces Postgres**, never Meilisearch (`:256-275`).
- Implementation: `CatalogQueryService.#listByViewerPrice` (`CAT/backend/services/catalog-query.service.ts:924-1125`)
  → `PricingService.orderByUnitPrice` (`PL/backend/services/pricing-service.ts:791-883`) →
  SQL builder `PL/backend/services/unit-price-ordering.ts`.
- **Buyer-specific**: yes. The viewer's candidate vector (`price-list-candidate-vector.ts:8-67`) is
  built from the same rules/priority as the card; sale streams lead base streams (`:35-41`). Every
  candidate list = one "stream". Identity with the card price is asserted by
  `test/integration/price_lists/unit-price-ordering.test.ts` (cited at `pricing-service.ts:773-776`).
- **Unit price only (qty 1)**: `min_quantity = 1` everywhere (`unit-price-ordering.ts:168-172`);
  the storefront says so to the buyer (`SF/components/CatalogToolbar.tsx:46-53`).
- SQL shape (`unit-price-ordering.ts:136-241`):
  ```sql
  select product_id, amount, stream_index from (
    (select b.product_id, b.amount, 0 from price_list_price_brackets b
      where b.price_list_id = $L0 and b.currency_code = $C and b.min_quantity = 1
        [and b.product_id = any($ids::uuid[])]            -- category rule / category filter
        [and (b.amount, b.product_id) > ($a, $p)]         -- keyset cursor
        [and b.amount between …]                          -- price range
      order by b.amount, b.product_id limit $n)
    union all
    (select … where b.price_list_id = $L1 …
        and b.amount <= $watermark                        -- bound from stream 0
        and (select 1 from price_list_price_brackets x0
              where x0.price_list_id = $L0 and … and x0.product_id = b.product_id limit 1) is null
      order by … limit $n)
    …) t order by amount, product_id
  ```
  Two statements per chunk: probe of stream 0 (fixes watermark), then merge of the rest
  (`pricing-service.ts:810-866`). Served from the partial covering index
  (`20260821T135907…:17-31`: 7.4 MB per 112k assignments, 132 MB per 1.6M; without it 206 ms + disk
  sort). Design measurements: `not exists` 208 ms vs scalar `limit 1` 0.69 ms; unbounded shadowed
  stream 179 ms vs watermark 2.88 ms (`unit-price-ordering.ts:13-41`).
- Matrix-bearing lists replace the index scan with a derived `distinct on` relation over
  `unnest(uuid[])` + correlated reference subqueries (`unit-price-ordering.ts:256-324`) — not index-ordered.
  Bench: ordered first page 3.1 ms without matrix, 41.4 ms with a category %, 21.3 ms with all-products % (`backend/test/perf/price_lists/matrix-resolver.bench.ts:37-45`).
- Cost drivers that scale with catalogue size (code-verified, magnitude inferred):
  - `restrictToProductIds` = **all product ids in the category tree** loaded into memory and shipped as
    a `uuid[]` literal in every chunk (`catalog-query.service.ts:972-974`, `unit-price-ordering.ts:176-179`).
  - Category rules: `listProductIdsInCategory` **sequentially per category id** (`pricing-service.ts:1160-1177`);
    matrix category/attribute selections the same (`:1085-1112`).
  - Visibility/channel/attribute filtering happens **after** each chunk in Node; scan budget
    `8 × limit` (`catalog-query.service.ts:199, 985, 1001-1004`) → short pages (open issue **#235**).
  - Unpriced tail: products-by-createdAt chunk + `pricedProductIds` per chunk (`:1038-1100`).
  - No total count on price-sorted pages by design (`:1120-1123`).
- **Price range without price sort** (`#listWithPriceRange`, `catalog-query.service.ts:1127-1200+`):
  not pushed into SQL — walks the default ordering in chunks, resolving prices per chunk, same
  8× budget → short pages under a selective range.

---

## 4. Search (Meilisearch) and admin_search

- **No price in the index**, deliberately: `IndexedDocument` has no price field
  (`packages/modules/search/src/backend/services/search-indexer.ts:135-153`). The legacy
  `attributes.defaultPrice` is still present inside `attributes` (`:150-152, 169`).
- Sortable attributes: only `createdAt`, `name` (`search-indexer.ts:69`). So **no price
  sort/filter in Meilisearch**; a request with `q` + price sort/range is routed to the Postgres ILIKE
  path (`CAT/backend/routes.public.ts:270-275`), losing typo tolerance (`:31-34`) (inferred consequence).
- **Re-priced after the hit, buyer-specific**: hits are re-read from Postgres and priced with the
  same batched `resolveListingPrices` for the viewer and currency (`packages/modules/search/src/backend/services/search-query.service.ts:262-291`) — "four statements" per page (`:273-275`). Audience filtering also post-hoc → short pages (#235).
- **Typeahead** (`suggestion-pricing-enricher.ts`, P0): one `resolveListingPriceDetails` call for
  the popup (it was a per-hit `resolveEngine` in `Promise.all`), returning `basePrice`/`salePrice`/
  `displayMode`. `basePrice` is now the listing chain's, so a product priced only by its own
  attribute shows it (it showed none). A pricing refusal degrades the whole popup to plain
  summaries; a switched-off `price_lists` is re-thrown. No currency passed (still open). The
  Meilisearch result path prices through the same call and carries `resolvedPrice`.
- `admin_search`: no price references in `packages/modules/admin_search/src` (grep for `price`
  returns nothing) — irrelevant.

---

## 5. Carts / orders / quote requests

**One cart line price chain** since #168 was settled on the P0 branch (there were two).

1. `CartLinePricing.orderablePrice` / `orderablePrices` (`packages/modules/carts/src/backend/services/cart-line-pricing.ts`):
   agreed price **only at the agreed quantity** → the price list at the line's quantity (one
   batched `resolveLinePrices` call for every line without an agreement, P0) → own `defaultPrice`
   labelled with the **basket channel's default currency** (P0; it was hard-coded `PLN`; a basket
   whose channel is gone is unpriced for it) → unpriced. Display mode `none` = quote-only. Amount
   rounded to 2 dp while brackets store 4 dp. Used on add/merge/qty change, the batch add, the
   login/reorder reprice and at placement; it passes the basket's customer account (P0).
2. `CartPricingRecompute.recompute` (`cart-pricing-recompute.ts`) for `GET /api/v1/cart` runs
   **chain (1)** — `CartLinePricing.orderablePrices` over the lines with their agreements, one
   batched `resolveLinePrices` call per read — so the read shows the price placement's drift check
   accepts (#168, ruled by the owner and fixed on the P0 branch). A line the chain refuses
   (unpriced, sold on request only, product gone) keeps its stored price on the wire and reads
   `unavailable: true` with `unavailableReason` `no_price_in_customer_list` / `not_purchasable`,
   since placement refuses it. Redis 30 s, refusals cached with the prices. `writeBackTo` has no
   caller (grep). It used to be a plain list price per line, with no agreed price, no own-price
   fallback and no display-mode check, so a quote-seeded line read at the list price and was
   charged the agreed one.

**Re-resolution at checkout: yes.** Order placement calls `cartPlacementApply.findPriceDrift` inside
the placement transaction, which re-runs chain (1) for the basket in one batched call (P0) and refuses with `409 CART_PRICE_CHANGED`
on any difference (`packages/modules/orders/src/backend/services/order-service.ts:1696-1727`;
`carts/src/backend/services/cart-placement-apply-port.ts:130-178`). It goes through the
in-process `PricingCache`, which since P0 is cleared on every process after a price write commits;
only a lost bump leaves "current" up to 60 s old.

Quote requests: reference price at submit via `BuyerLinePricePort`
(`packages/modules/quote_requests/src/backend/services/reference-price.ts:5-16, 66-90`) →
`BuyerLinePriceService` (chunks of 100, **one `resolveLinePrices` call per chunk** since P0);
resolves the account's own customer group through `effectiveCustomerGroupId`. An
accepted quote seeds the cart with the agreed price + agreed quantity (chain 1, step 1). Quote line
currency is hard-coded PLN (open issue **#303**).

Orders: admin order preview prices per line with currency and customer group
(`orders/src/backend/routes.ts:974-984`); external order intake only probes "is there any price"
with `defaultPrice` fallback (`order-api-intake-service.ts:352-376`).

---

## 6. Promotions vs. sale price lists vs. compare-at

- Price lists have `type base | sale` (`…engine.ts:58-61`). A sale list is a separate partition;
  when it prices the product it **wins outright** (`pricing-service.ts:88-110`). There is no
  "compare-at" field — the "was" price is simply the base partition's bracket.
- Strikethrough is rendered only where the full engine result (`basePrice` + `salePrice`) reaches the
  UI: PDP (`SF/app/(catalog)/p/[slug]/page.tsx:311`, `SF/components/pricing/BaseSalePriceBlock.tsx:13-15, 80-110`),
  home bestsellers and typeahead. **PLP cards get only the winning amount** (`ProductSummary.price`;
  `listingPriceFrom` drops `isSale` on the wire via `listingPriceMoney`, `packages/contracts/src/price-lists.ts:540-546`;
  `SF/components/ProductGrid.tsx:43`).
- Promotions (`packages/modules/promotions`) are **cart-only** and compute **on top of the stored
  cart line `unitPrice`** — i.e. on the already-resolved sale/base/agreed price
  (`promotion-service.ts:324-335`, `backend/actions/util.ts:9, 24`). Rule dimensions: cart total,
  payment/delivery method, country, postcode, organization, customer group, category, attribute
  (`promotion-rule-evaluator.ts:36-80`). **No "price list" / "is on sale" criterion** — a promotion
  stacks on a sale price with no way to exclude it. Promotions are never shown on PLP/PDP; the
  toolbar note says "promotions are applied in the cart" (`SF/components/CatalogToolbar.tsx:46-53`).
  `price_lists` is only an optional rule dimension in the manifest (`promotions/src/manifest.ts:37-41`).

---

## 7. Performance tests, budgets, indexes

Benches (all `describe.skipIf(PERF_RUN !== 'true')`), as they stand after feature 160:

| Bench | What | Budget / latest measurement |
| --- | --- | --- |
| `backend/test/perf/price_lists/price-surface.bench.ts` | SC-005: price-sorted and range pages over the surface, 50 000 products, 1 000 organizations; refresh latency; since 2026-10-23 also 202 built profiles and a PIM-like import | p95 ≤ **150 ms** per page, a change visible ≤ **60 s**; 2026-10-23 (targeted refresh): page p95 ≤ 27.4 ms, write → visible 0.20–0.49 s, import probes p95 0.50 s; T133 (2026-10-22, whole rebuilds): p95 ≤ 28.2 ms, refresh 47.2 s |
| `backend/test/perf/price_lists/book-resolver.bench.ts` | a 50-product listing page on the price-book resolver (replaced `matrix-resolver.bench.ts`) | budget **60 ms** p95; 13.0 ms (no book), 11.5 ms (100 rows), 11.1 ms (1 950 rows on other products) |
| `backend/test/perf/price_lists/book-lines-page.bench.ts` | the admin grid's line pages, 50 003-line base book (161 G15) | budget **150 ms** p95; steady: every case ≤ 150 ms, largest 125.3 ms; fresh data before the first autovacuum: three broad-search cases 150.6–152.6 ms (accepted, issue #409) |
| `backend/test/perf/price_lists/editor-import-save.bench.ts` | a 5 000-row import preview and commit; a 1 000-row file to preview | preview 205 ms, commit 1 024 ms; 83 ms (2026-10-23) |
| `backend/test/perf/catalog/listing-price-cost.bench.ts` | anonymous priced page over HTTP | budget **275 ms** p95 (pre-160 measurement 77–87 ms) |
| `backend/test/perf/catalog/listing-price-viewer-cost.bench.ts` | cold/warm, anonymous vs signed-in, statement counts | ceiling 60 statements (signed-in cold); T173 (2026-10-23, price-book engine): anonymous cold 20 / 101.3 ms, warm 16, p95 24.2 ms; signed-in cold 24 / 36.2 ms, warm 23, p95 25.2 ms — baselines below |
| `backend/test/perf/catalog/listing-filtered-page.bench.ts`, `listing-card-reads-cost.bench.ts`, `carts/cart-routes.bench.ts` | adjacent | not pricing-specific |

Deleted with the old model (feature 160, T126): `price_lists/resolver.bench.ts` (superseded by
`book-resolver.bench.ts`), `price_lists/matrix-resolver.bench.ts` (rewritten as
`book-resolver.bench.ts`) and `catalog/price-sort-cost.bench.ts` (it measured the feature-086 SQL
builder; the SC-005 bench measures the surface).

**SC-004 baseline (feature 160, T002).** Re-measured with `PERF_RUN=true` on
`feat/160-pricing-model-v2` before the engine switch (old model, one developer machine, local
PostgreSQL):

| Bench | Measured |
| --- | --- |
| `price_lists/resolver.bench.ts` | 50 lists × 5 brackets, 200 iterations: p50 8.71 ms, p95 **12.87 ms**, p99 14.06 ms (budget 35) |
| `catalog/listing-price-viewer-cost.bench.ts`, anonymous, page 50 | cold 15 statements / 68.9 ms; warm **12** statements, p50 23.3 ms, p95 **24.8 ms** |
| `catalog/listing-price-viewer-cost.bench.ts`, signed-in, page 50 | cold 20 statements / 41.7 ms; warm **19** statements, p50 27.4 ms, p95 **29.3 ms** |
| `catalog/price-sort-cost.bench.ts`, HTTP, page 50, 5 000 products | p50 28.1 ms, p95 **31.2 ms** |

**SC-005 and the price-book resolver (feature 160, T088).** Measured 2026-10-22 on the price-book
engine (same machine), `PERF_RUN=true`, after the owner decision that **a request never waits on a
surface build** (`specs/160-pricing-model-v2/contracts/price-surface.md` §3): two runs of
`price_lists/price-surface.bench.ts` (50 000 products, 1 000 organizations, 500 with books, 20 group
books, one everyone book), every scenario asserting that no request writes the surface.

| Scenario | Run 1 | Run 2 | Budget |
| --- | --- | --- | --- |
| first page / desc / range p95, guest | 3.9 / 3.8 / 3.9 ms | 4.0 / 4.0 / 3.6 ms | 150 ms |
| same, group-only | 7.2 / 8.1 / 6.0 ms | 7.1 / 7.0 / 6.9 ms | 150 ms |
| same, organization product rows | 83.9 / 8.0 / 102.4 ms | 14.4 / 7.1 / 24.1 ms | 150 ms |
| same, organization category % | 110.1 / 7.7 / 7.5 ms | 80.9 / 8.8 / 7.8 ms | 150 ms |
| same, organization all-products % | 6.3 / 6.3 / 5.4 ms | 7.2 / 7.0 / 7.4 ms | 150 ms |
| a never-built first page (no build) | 26–40 ms | 9–13 ms | recorded |
| a guest page while stale (previous surface) | 5.5 ms | 5.6 ms | 150 ms |
| one book change until the sorted listing shows it | 56.9 s | 42.0 s | 60 s |
| worker build of the five profiles | 53.5 s | 60.0 s | recorded |
| profile-miss page (250 products, live) | 55 ms | 144 ms | recorded |

Storage: 5 profiles, 101 205 rows, 24 MB; extrapolated to the fixture's 520 profiles about 2.6 M rows,
under research R7's 10 M, so the profile-factor task is not due. `price_lists/book-resolver.bench.ts`,
a 50-product listing page: no book p95 13.0 ms; 100 rows 11.5 ms; 1 950 rows on other products
11.1 ms (budget 60). Before this change a request that met a never-built or stale profile built it
synchronously — up to 61.2 s for an all-products percentage — and the all-products descending page
measured 2 401.9 ms p95 before `PriceSurface` skipped the everyone stream for a buyer surface holding
every product. The organization pages vary between runs (up to 110 ms p95 against 18 ms in an
earlier run); all stay within budget, and the refresh is within its 60 s with little headroom.

**Final verification (feature 160, T133, 2026-10-22).** The SC-005 bench green on the release
branch: every page p95 ≤ 28.2 ms, a single-book change visible in the order after 47.2 s.

**The editor (feature 161, 2026-10-22/23).** The admin grid's line pages and the CSV import, on the
same machine: figures in the bench table above and in `specs/161-price-book-editor/plan.md`
*Measurements*.

**Targeted refresh (owner ruling 2026-10-23, research R17, T165).** The figures above (T088, T133)
are history: they were measured while every bump rebuilt every profile. After the targeted refresh,
same machine, idle, the default fixture, 50 iterations (run 4 of the day, after the coverage-check
fix, T175):

| Scenario | Measured | Budget |
| --- | --- | --- |
| first / desc / range page p95, guest | 4.1 / 3.2 / 3.8 ms | 150 ms |
| same, group-only | 5.9 / 6.8 / 27.4 ms | 150 ms |
| same, organization product rows | 6.7 / 6.1 / 15.0 ms | 150 ms |
| same, organization category % | 7.7 / 6.9 / 16.8 ms | 150 ms |
| same, organization all-products % | 6.8 / 5.6 / 6.2 ms | 150 ms |
| worker build of the five profiles | 23.2 s (a buyer profile resolves only the products its own books select) | recorded |
| one book change through `markStale` (every profile rebuilt) | 21.0 s | 60 s |
| profile-miss page | 56 ms | recorded |
| 202 built profiles (1 131 693 rows, 269 MB): their whole build | 241.3 s | recorded |
| write → visible, everyone book row / base price through `priceBookWritePort` | 0.43 s / 0.43 s (31 profiles marked and refreshed, 171 untouched, none rebuilt whole) | 60 s |
| write → visible, organization book row | 0.20 s (1 marked, 201 untouched) | 60 s |
| write → visible, `product.updated.v1` | 0.49 s | 60 s |
| PIM-like import, 3 000 products (a `product.updated.v1` and a base price each, bursts of 500), worker beside it | 436.8 s, 6.9 products/s, 206 worker passes; 29 probe writes visible after p95 0.50 s, max 0.55 s | 60 s per probe |
| full rebuild of the 202 profiles | 274.7 s | recorded (input to P3) |

Before the coverage-check fix the first page of the all-products buyer took 428 s, then 47 s as a
scalar probe, on a `price_profile_prices` analysed while empty; the check now compares the two
surfaces' ids in memory and a large whole build runs `ANALYZE` in its own transaction
(`backend/test/integration/price_lists/price-surface-plans.test.ts`).

**SC-004 on the price-book engine (T173, 2026-10-23, idle).**
`catalog/listing-price-viewer-cost.bench.ts`, page of 50:

| Viewer | Cold | Warm | p50 / p95 |
| --- | --- | --- | --- |
| anonymous | 20 statements / 101.3 ms | 16 statements | 22.6 / **24.2 ms** |
| signed-in | 24 statements / 36.2 ms | 23 statements | 23.7 / **25.2 ms** |

The bench's ceiling (60 statements for a cold signed-in page) holds. Against the old engine the
page costs more statements and about the same time: the bench's own recorded baseline (2026-08-20)
is cold 14 / 15 and warm 11 / 15 statements, p95 22.0 / 22.4 ms (anonymous / signed-in), and the
T002 re-measure above cold 15 / 20 and warm 12 / 19, p95 24.8 / 29.3 ms. In the same run the admin
lines page on a 50 000-line base book measured p95 48.1–111.8 ms over its twelve page and search
shapes (budget 150), and the editor's 1 000-row read and preview 81 ms, a 5 000-row preview 192 ms
and commit 974 ms.

What is **not** measured (gap): catalogue scale beyond 5 000 products for the listing path; the
write → visible time of a change that rebuilds hundreds of profiles whole (an all-products or
attribute-only row, a channel event — a full rebuild of 202 profiles is recorded at 274.7 s, not
asserted against SC-005); multi-replica cache behaviour; typeahead and cart/checkout with large
baskets. (The typeahead, external-API and cart N+1 paths are batched since
P0, with a statement-count assertion in `line-prices-batch.test.ts`.)

Specs: the canonical tree carries only `specs/148-price-list-matrix-rules/` for pricing
(plan `:55` "budget test"); features 011 (engine) and 086 (price sort) are pre-migration and
reachable only as citations (`specs/pre-migration-history/`). `specs/deferred-defects.md` **does not
exist** in this checkout.

Complexity summary (per request, cache miss):

| Path | Statements | Scaling |
| --- | --- | --- |
| Listing page (batched) | ~8–15 | constant in page size; CPU O(products × active lists) |
| `resolveEngine` / `resolveLinePrice` | ~7 (+1 per bracket fall-through, +1 account read for a signed-in customer) | per product / per line |
| `resolveLinePrices` — cart GET, batch add, placement drift, quote reference, external API (P0) | 12 for 9 lines and for 45 (fixture) | constant in lines |
| Typeahead (P0) | one listing batch | constant in hits |
| Admin order preview, order intake probe, product feeds | ~7 × lines | **linear, sequential** |
| PDP (P0) | listing batch(1) | 1 resolution |
| Price-sorted page | 2 per chunk + visibility/tail reads; up to 8×limit rows scanned | O(category size) for the id array; O(categories in rules) sequential reads |

---

## 8. Known issues — why pricing keeps coming back

Public tracker (`gh issue list … --search price`), pricing-related:

| # | State | Title (short) | Theme |
| --- | --- | --- | --- |
| 378 | open | Replace "Products & brackets" with a rebuilt multi-currency Price matrix | two authoring models (brackets vs matrix) |
| 377 | open | PDP: configurable products (variant price) | no variant dimension |
| 168 | open | `GET /cart` shows re-resolved prices, checkout uses stored | fixed on the P0 branch: one chain for the read and placement (`cart-read-equals-placement.test.ts`) |
| 166 | open | Reorder seeds the basket at old order prices | fixed: a reorder seeds every line at the price this buyer may order it at now (one batched `CartLinePricing.orderablePrices` call), leaves out a line nobody may order now and reports it in `unavailableItems` with `reason: 'no_price'` beside the discontinued ones (`backend/test/contract/orders/reorder-current-prices.test.ts`); placement refuses drift (`place-order-line-price-current.test.ts`) |
| 165 | open | Quote-seeded line keeps agreed price at any quantity | fixed in code by commit `7d2d00fcc` (agreed price only at the agreed quantity, `cart-line-repricing.test.ts`); issue still open |
| 167 | open | Quote validity checked at seeding, not placement | still open: the placement drift check honours an agreed price after the quote lapsed (a lapse only drops the minimums exemption) |
| 303 | open | Quote lines always stored in PLN | the cart half (own-price fallback labelled PLN) fixed by P0; quote lines still stored in PLN |
| 235 | open | Search and price-ordered lists answer short pages | post-hoc filtering + scan budget |
| 96 | open | `DisplayModeOverrideRow` untranslated | — |
| 236 | closed | Quote-only product could be added to cart when no list held it | display mode vs unpriced |
| 249 | closed | Currency never forwarded by the storefront | currency plumbing |
| 151 | closed | Product list filtered after cutting the page | pagination correctness |
| 279, 284, 291 | closed | base price in quote view; disable negotiation; picker in tier editor | admin UX |

**Caveat on issue numbers in code comments**: most `issue #NNN` citations in pricing code (#50,
#84, #124, #132, #143, #227, #263, #265, #271, #287) refer to the **pre-migration** tracker; on the
public GitHub tracker the same numbers are unrelated PRs/issues (e.g. #132 = a docs fix, #265 = an
SEO feature). #151, #236, #249 do match. Cite slugs/MRs, not bare numbers, in the redesign.

Recurring root causes visible in code:
1. **Multiple sources of truth for "the price"**: `defaultPrice` attribute vs Default list brackets
   vs matrix entries vs stored `cart_items.unit_price` vs agreed quote price vs reorder snapshot (§1, §5).
2. **Multiple resolution chains** written by each consumer: listing chain, cart `orderablePrice`,
   cart `recompute` (merged into the cart chain by #168), order intake probe, buyer-line-price — each with different inputs
   (currency, customer group, agreed price, own-price currency) (§2.2, §5).
3. **Rules in JSONB** → no indexable "which lists apply to me", full active-list scan + in-memory
   evaluation every request, and price-sort needs a bespoke stream-merge SQL engine (§0, §3).
4. **Per-viewer prices can't be indexed** in Meilisearch → search can't sort/filter by price (§4).
5. **Cache is per-process and coarse**; since P0 it is cleared after commit on every process and by
   the sweeper, but not by catalog writes (§2.4).
6. **Currency and variant are second-class**: hard-coded PLN on quote lines (the cart's was removed
   by P0), no variant column, currency not passed on the typeahead (§1, §2.2, #303, #377).
7. **N+1 survived on every non-listing path** until P0; the admin order preview, the order intake
   probe and product feeds still loop (§2.3, §7).
