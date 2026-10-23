---
title: Pricing for developers
sidebar_label: Pricing for developers
sidebar_position: 2
description: How price books are stored and resolved, the batched pricing service every consumer reads through, caching, the price surface behind price sorting, the admin API, the ports and the conversion from the old model.
---

# Pricing for developers

How the `price_lists` module stores and resolves prices, and what another module — or an overlay —
may rely on. What the rules mean for an operator is on the [module's main page](../price_lists.md);
the admin screens are on [The price-book editor](./price-book-editor.md).

The normative design documents are in the repository: the decision record of the model
(`specs/pricing/decision-record.md`), its test vectors (`specs/pricing/worked-examples.md`), the
current state of the code (`specs/pricing/current-model.md`), every read path with its measured cost
(`specs/pricing/read-paths-and-performance.md`), and the working rules for any change that touches
a price (`specs/conventions/pricing.md`).

## Where the code lives

Paths are relative to this module's package, `@endora-commerce/mod-price-lists`, unless they name another package.

| Concern | Path |
| --- | --- |
| Shapes (Zod) — books, rows, explanation, precedence, base prices, the write port | `packages/contracts/src/price-books.ts` |
| Shapes — listing price, line price, the published pricing ports | `packages/contracts/src/price-lists.ts` |
| Decimal helpers shared by the server and the admin previews | `packages/contracts/src/price-book-decimal.ts` |
| The pure three-tier resolver | `src/backend/services/book-resolver.ts` |
| Presets, invariants, rank table | `src/backend/services/precedence.ts` |
| Loading a batch (books, rows, catalogue facts) and mapping results | `src/backend/services/book-pricing.ts` |
| Pricing profiles | `src/backend/services/pricing-profile.ts` |
| The pricing service — the batched entry points | `src/backend/services/pricing-service.ts` (contract: `pricing-service.interface.ts`) |
| Writes through the Command Bus | `src/backend/services/price-book-service.ts`, `price-book-batch.ts`, `price-book-rules.ts` |
| Admin reads (list, rows, lines, labels) | `src/backend/services/price-book-reads.ts` |
| Sales-representative scope | `src/backend/services/price-book-scope.ts` |
| Cache and cross-process invalidation | `src/backend/services/pricing-cache.ts`, `pricing-generation.ts` |
| Price surface and its worker | `src/backend/services/price-surface.ts`, `workers/price-surface-worker.ts`; what a write marks: `surface-change.ts` |
| Admin API | `src/backend/routes.price-books.ts`; display modes in `routes.ts` |
| Storefront API | `src/backend/routes.storefront.ts` |
| Composition — ports, worker, subscriptions, channel bridge | `src/backend/index.ts` |
| Admin screens | `src/admin/`; the editable grid primitive in `packages/admin-kit/src/components/editable-grid/` |
| Demo books (E1–E3) | `src/backend/demo/` |

## Data model

Every table is owned by `price_lists` unless named otherwise. A price book is the evolved price
list, which is why the tables keep their old names.

| Table | Holds |
| --- | --- |
| `price_lists` | The book header: `name`, `type` (`regular`, `sale`), `status` (`draft`, `scheduled`, `active`, `expired`), `starts_at`, `ends_at`, `currency_code` (immutable), `audience_kind` (`everyone`, `customer_groups`, `organizations`; immutable once `ever_activated`), `priority`, `is_system` (true for base books only; unique per currency), `version` (moves on every write to the book). |
| `sales_channel_price_lists` | The channel set — a registered sales-channel bridge (entity type `price-list`), read and written only through `SalesChannelMembershipService` (Principle XII). A binding whose channel stops offering the currency stays and is *dormant*. Base books have no bindings. |
| `price_list_audience_members` | The audience set: `organization_id` or `customer_group_id`, exactly one per row, all of the header's kind; foreign keys cascade on a permanent delete. |
| `price_list_matrix_entries` | The rows: the selection (`variant_id` with its `product_id`; `product_id`; `category_id`; `attribute_key` + `attribute_value`; category ∩ attribute; or nothing = all products), `min_quantity`, `max_quantity`, `price_type` (`fixed`, `percent`, `amount`) with `amount` (numeric 14,4) or `percent` (signed numeric 7,2). |
| `price_list_product_lines` | One row per product with a row in a book — the grid's paging by line. |
| `price_list_precedence` | The versioned precedence: twelve cell codes, `category_before_attribute`, `depth_mode`, `state`. Version 1 = HY is installed active; there is no write path yet. |
| `price_profiles`, `price_profile_prices`, `price_profile_stale_products` | The price surface and its refresh marks (below). |
| `price_display_mode_overrides` | Display modes per organization, category and product. |
| `cart_items.price_source` (`carts`), `order_items.price_source` (`orders`) | Which tier priced a line: `agreed`, `base`, `catalogue`, `buyer`, `sale`; `null` for a line priced before the release. |

A product carries no price of its own: a product's price is its rows in the base book of each
currency. The catalogue fields this release removed are listed under *Upgrading from the old model*
below.

Write rules (`price-book-rules.ts`, `price-book-batch.ts`): no two rows of one book with the same
selection and overlapping quantity windows; a fixed price needs a selection other than *all*; an
attribute row only for an attribute with `isPriceRule` of a choice or boolean type that is neither
language- nor channel-scoped (re-read at resolution, so an attribute that stops qualifying silently
stops pricing); a base book holds product rows (fixed) and variant rows (fixed, percent, amount)
only; at most `PRICE_BOOK_MAX_ROWS` (5 000) rows per non-base book and per batch.

## Resolution

### Inputs

A resolution names a product (`id`, `attributeValues`), an optional variant, a quantity, a sales
channel (`id`, `defaultCurrency`), an optional currency (default: the channel's), and the buyer:
an organization and, for a signed-in customer, `customerAccountId`. **The caller names the buyer;
it does not resolve the group.** The engine applies one rule everywhere
(`customer-group-rule.ts`, `effectiveCustomerGroupId`): an explicit `customerGroupId`, else the
customer account's own group when the account belongs to the organization, else the organization's
group. The organization chain (nearest first) comes from `organizations`'
`organizationInheritancePort.priceListOrgChain`.

A currency the channel does not offer prices nothing, base prices included — the guard fails
closed, it never converts.

### Applicable books

One statement loads the books a batch can meet (`book-pricing.ts`): the base book of the currency,
plus every non-system book with `status in ('active', 'scheduled')`, `starts_at <= now() < ends_at`
(evaluated in the statement, so a schedule takes effect at its instant, not at the next status
sweep), of the currency, bound to the channel through the bridge's sanctioned subquery
(`entityIdsInChannelSubquery`) with the channel offering the currency, and whose audience is
everyone or includes a member of the buyer's chain or the effective group. **No book id ever comes
from a client** — that `where` clause is the tenancy guard (Principle XI).

### The algorithm

`createBookResolver` (`book-resolver.ts`) is pure: it reads only what the batch loaded.

```text
1. BASE       the base book's variant row covering q (fixed, or a percent/amount
              of the product's base at q), else the product's fixed row      → b
2. CATALOGUE  best row of the regular *everyone* books, ranked by selection kind
              (variant > product > category ∩ attribute > category > attribute > all,
              category/attribute per the toggle); percent/amount off b        → C, else b
3. BUYER      best row of the regular organization-set and group-set books,
              ranked by the precedence's rank table; percent/amount off C     → R, else C
4. SALE       best row of the sale books — buyer cells by the rank table, then
              everyone rows by selection kind; percent/amount off C           → S
5. CHARGE     S when S < R (R becomes compareAt), else R; nothing → unpriced
```

Inside a tier the order key is total and lexicographic: **cell rank → chain depth → priority
(desc) → starting quantity (desc) → resulting amount (asc) → book id → row id**. Under the AF-N
preset the depth moves ahead of the cell for organization cells. A row whose reference is missing
(a percentage with no base) or whose result is below zero does not price, and the next candidate is
tried; zero is a price. A product row matches every variant of the product; a variant line matches
attribute rows on the product's values overlaid by the variant's axis values; a category row matches
the product's own category assignments. Percentages are applied half-up to four decimal places in
integer arithmetic (`matrix-decimal.ts`). When no regular tier prices a line but a fixed sale row
does, the sale is charged with no compare-at price.

### The precedence and its rank table

A **cell** is audience × selection kind — `org.variant`, `org.product`, `org.category_attribute`,
`org.category`, `org.attribute`, `org.all` and the six `group.*` cells
(`PRICE_BOOK_CELL_CODES`). The active version of `price_list_precedence` orders the twelve;
`buildRankTable` turns the order into each cell's rank, the first component of the order key.
`validatePrecedence` holds the invariants: within one audience the selection order is fixed (I1);
`org.<kind>` before `group.<kind>` (I2); the category/attribute toggle is the same everywhere (I3);
nearest-organization-first depth only with the AF order (I5). Exactly 266 configurations satisfy
them, and `precedence.test.ts` enumerates all of them.

| Preset | Order | Depth |
| --- | --- | --- |
| **HY** (installed as version 1) | `org.variant`…`org.attribute`, `group.variant`…`group.attribute`, `org.all`, `group.all` | within the cell |
| AF | the six `org.*` cells, then the six `group.*` cells | within the cell |
| SF | `org.variant`, `group.variant`, `org.product`, `group.product`, … | within the cell |
| AF-N | as AF | nearest organization first |

`PrecedenceStore` reads the active version once per pricing generation and refuses to price from a
missing or invalid one rather than silently falling back. `GET /api/v1/admin/price-books/precedence`
answers it; every write under `…/precedence` answers `409 PRECEDENCE_CHANGE_UNAVAILABLE` until the
change flow exists.

### Explanation

Every resolution carries its explanation (`BookExplanation`): the tier, the cell, the book and row,
the reference price used, the precedence version and up to ten ranked candidates of the deciding
tier. It is internal to the module's contract; `POST /api/v1/admin/price-books/resolve` publishes it.

## The one read path

**A consumer prices in batches, through the pricing service.** The entry points
(`PricingServiceContract`, `pricing-service.interface.ts`) cost a constant number of statements
whatever the number of products or lines — the applicable books, their rows for the batch, the base
rows, and the catalogue facts (categories, variants with axis values, eligible attributes) through
`catalog`'s ports, one call each and only when a row needs them:

| Method | For | Answers |
| --- | --- | --- |
| `resolveListingPrices` | a listing at quantity 1; variant products are ranged over their variants | `Map<productId, ListingPrice>` — `{ source: 'price_list', amount, currency, priceListId, isSale, priceSource, compareAtAmount?, variesByVariant?, maxAmount? }` or `{ source: 'none' }` |
| `resolveListingPriceDetails` | a surface that renders the split (product page, home cards, typeahead) | `ListingPriceDetail` — the listing price, `basePrice` (the regular price), `salePrice`, `displayMode`, `tiers { base, catalogue, buyer, sale }` and `listPrice` when shown |
| `resolveLinePrices` | many lines, each at its own quantity and variant (cart, placement check, quote reference prices, admin order preview, external order intake, feeds, external catalogue API) | `Map<key, PricingLineResult \| null>` — `amount`, `currency`, `priceListId`, `isSale`, `source`, `compareAt`, `bracketStartQuantity` (the starting quantity of the row that priced it), `displayMode` |
| `resolveEngine`, `resolveLinePrice` | one product or line | wrappers over a batch of one; never call them in a loop |
| `orderByUnitPrice`, `pricedProductIds`, `pageDisplayMode` | price sort and range (`ListingPriceOrderPort`) | served from the price surface |
| `namedListPrices`, `namedListPublishability` | a feed pinned to one book | `namedListPrices`: the book's rows that are not variant rows, at quantity 1, over the channel's catalogue price **without the pinned book**; products it does not price are absent, and the map is empty while the book does not publish. `namedListPublishability`: whether it publishes now — `{ publishable: true }` or `{ publishable: false, reason }` |
| `listTierStarts` | a tier ladder | the starting quantities of the rows and base tiers that can apply to `(product, variant?, currency)` |

**A book pinned to a feed publishes only while it would price an anonymous buyer on the feed's
channel now** (`BookPricing.namedBookPublishability`, `book-pricing.ts`): its status is `active` or
`scheduled` and `starts_at ≤ now < ends_at`, evaluated at the call rather than by the status sweep;
it is bound to the feed's channel and the channel offers the currency; and its audience is
everyone. Otherwise `namedListPublishability` answers the first condition that fails, in this
order — `not_found`, `currency_mismatch`, `not_active`, `outside_schedule`, `not_on_channel`,
`audience_restricted` (`pinnedPriceBookUnpublishableReasonSchema` in
`packages/contracts/src/price-lists.ts`) — and `namedListPrices` answers an empty map. A base book
is channel-independent and always active: it publishes whenever its currency is the feed's, and
answers its base prices. For any other book the reference its percentages and adjustments are taken
off is the guest's catalogue price over the channel's books **minus the pinned one**, so a pinned
everyone book never discounts its own result.

Consumers resolve the `pricingService` container entry through a published slice of it in
`@endora-commerce/contracts` — `ListingPricePort`, `ListingPriceDetailPort`, `LinePricesPort`,
`ListingPriceOrderPort`, `OrgLinePricePort` — with `lazyPort`, so a missing owner refuses with
`MODULE_DISABLED` at the call instead of a stale instance answering. Who reads what:

| Consumer | Entry point |
| --- | --- |
| `catalog` — listings, the product page, product links, home cards | `resolveListingPrices` / `resolveListingPriceDetails`; `ProductSummary.price` and `ProductSummary.resolvedPrice` carry the answer |
| `catalog` — price sort and price range (`?sort=price`, `?sort=-price`, `minPrice`, `maxPrice`) | `orderByUnitPrice`, `pricedProductIds` |
| `catalog` — the external catalogue API | `resolveLinePrices`; the tier ladder through `listTierStarts` |
| `search` — hits and suggestions | `resolveListingPriceDetails` (the Meilisearch index carries no price) |
| `comparisons` | `resolveListingPrices` |
| `carts` — add, merge, quantity change, read, the placement check | `resolveLinePrices` inside `CartLinePricing.orderablePrices` |
| `orders` — placement, admin preview, external intake | placement copies the cart line's price and `price_source`; preview and intake call `resolveLinePrices` |
| `quote_requests` — reference prices | `BuyerLinePricePort.resolveForBuyer` (container `buyerLinePricePort`) |
| `product_feeds` | `resolveLinePrices` as a guest; `namedListPrices` and `namedListPublishability` for a feed pinned to a book |
| `organizations` — the organization's effective price books | `PriceListReadPort.listForOrganization` (container `priceListReadPort`) |
| `carts` — refusing a product sold on request only | `ProductDisplayModePort` (container `productDisplayModePort`) |

`backend/test/integration/price_lists/pricing-surfaces-agree.test.ts` holds every one of them to
the same amount, currency and source for every buyer of the fixtures, and the identity tests
`listing-prices-batch.test.ts` (batch = single), `line-prices-batch.test.ts` (batch = one
`resolveLinePrice` per key) and `price-surface-identity.test.ts` (sorted order = live card prices)
keep the paths equal. A new resolution path owes the same kind of identity test.

**Decorating the pricing service from an overlay.** A deployment overrides pricing from its own
overlay module with `ctx.di.decorate('pricingService', …)`. Decorate `resolveLinePrices` and
`resolveListingPrices` as well as the single calls: the cart, the placement check, quote reference
prices and the external API price through the batch, so a wrapper of the single call alone leaves
them on core. `backend/src/apps/example/modules/example_overlay/backend.ts` is the reference.

## Caching and invalidation

- **Per process**: `PricingCache`, an LRU of 5 000 entries with a 60 s TTL
  (`DEFAULT_PRICING_CACHE_TTL_MS`), keyed by pricing profile, product, variant and quantity; and a
  memo of the profile per organization chain, group, channel, currency and precedence version. The
  test harness sets the TTL to 0.
- **After commit, everywhere**: every audited price-book write runs through `CommandBus.run`, and
  once it has committed `PricingGeneration.bump()` clears this process's layers and publishes on the
  Redis channel `b2b:price_lists:pricing-generation`; every API and worker process subscribes on boot
  and clears its own. A bump also hands the price surface a description of what the write changed
  (a `SurfaceChange`, below), which marks what that change can move and asks the worker for a
  refresh; a bump that describes nothing marks every profile.
  Publishing is best effort: when an announcement is lost, the 60 s TTL bounds another process's
  staleness.
- **What bumps**: every price-book write (header, channels, members, rows, activation, duplicate,
  delete, base prices), a status sweep that flips a book, and the catalogue and channel events this
  module subscribes to — `product.created.v1`, `product.updated.v1`, `product.archived.v1`,
  `product.deleted.v1`, `category.updated.v1`, `attribute.updated.v1`,
  `sales_channels.identity_changed`, `sales_channels.lifecycle_changed`.

## The price surface — price sort and price range

A per-buyer price cannot be indexed in Meilisearch, and resolving a whole catalogue per request is
too slow, so price sorting and price-range filtering read a precomputed **price surface**.

- A **pricing profile** (`price_profiles`) is a channel, a currency, a precedence version and the
  sorted vector of the buyer books that apply — `(book, audience kind, chain depth)`. Buyers with the
  same applicable books share a profile; guests and buyers with no buyer book share the *everyone*
  profile.
- `price_profile_prices` holds, per profile and generation, each product's quantity-1 price (the
  lowest variant price for a variant product), the highest, the compare-at price and the source
  tier. The everyone profile holds every priced product; a buyer profile only the products whose
  answer differs. Every row is computed by the same batched resolver the cards use.
- A buyer's page is a **two-stream merge**: the buyer profile's rows, then the everyone profile's
  rows minus the products the first stream holds — two index-ordered streams whatever the number of
  books.
- **No request builds a surface.** A write marks what it moved, and a marked profile keeps serving
  its rows until the worker has refreshed them, in one transaction. A profile never built is
  registered and its build requested, and the request is answered at once: a restriction of up to
  5 000 products (a category, a search result) is ordered from a live resolution, an unrestricted
  page from the everyone surface (an approximation), and with no surface at all the chunk is
  `unordered` and the catalogue serves its default order. Prices on cards are always resolved live,
  so only the order can lag.
- **A write marks only what it can move**, at two granularities. Each writer describes its change
  as a `SurfaceChange` (`src/backend/services/surface-change.ts`) and `PricingGeneration.bump`
  hands it to `PriceSurface.markChanged` after the commit, which writes every mark of the change in
  one transaction: a **(profile, product) mark** — a row of `price_profile_stale_products` — for
  each product the change concerns in each profile it reaches, or a **whole-profile mark**
  (`price_profiles.stale`, `marked_at`) when it concerns every product of the profile. A change to
  a book that was or is `active` or `scheduled` concerns the products its rows select, in the
  profiles whose vector holds it (a buyer book), the profiles of its currency on its channels
  before and after (an everyone book) or every profile of its currency (a base book); a base price
  and a product event concern the product in every profile (of the written currencies, for a base
  price); a category event the products of the category's subtree; an attribute event the products
  the rows naming the attribute select. A buyer surface stores only what differs from the everyone
  surface, so a change at everyone level marks a product in a buyer profile only when one of the
  profile's books can select the product or the profile's surface holds a row for it — any other
  buyer resolves that product over the everyone profile's books and answers what it answers. A
  change that concerns more than
  10 000 products, a row that selects by attribute alone or every product, a channel event and the
  precedence mark their profiles whole. A new or duplicated book (a draft), a display mode and the
  list-price switch mark nothing; deleting a book also drops the buyer profiles whose vector holds
  it. When the marking itself fails, every profile is marked whole.
- The **worker** consumes the BullMQ queue `price_lists.surface` (one coalesced job id, three
  attempts with exponential backoff), attached with `ctx.worker` so it stops with the module, and
  runs only in a process that consumes queues (`BACKEND_ROLE` unset, `all` or `worker`) with a queue
  Redis connection. Each pass reads its work in one statement: a never-built or whole-marked profile
  is built whole — the next generation beside the served one, swapped in one transaction — and a
  profile with (profile, product) marks has just those products re-resolved and their rows of the
  served generation replaced in one transaction, which moves `price_profiles.revision`. Every
  everyone profile of a pass is done before any buyer profile, never-built ones first within each,
  because a buyer surface is compared with the everyone surface the pass leaves. A pass deletes
  only the marks it read, by id, so a write landing during a pass is done by the next one; passes
  repeat while one finds work. A whole build that writes a large share of `price_profile_prices`,
  or writes into a table with no statistics, runs `ANALYZE` on it inside its own transaction.
  Without a running worker the surface is never built and price-sorted pages fall back as above.

**Freshness bound (SC-005).** A targeted change is visible in the sort within 60 s; a
catalogue-wide one — a change that marks its profiles whole: an all-products or attribute-only row
on an everyone or base book, a `sales_channels.identity_changed` or `lifecycle_changed` event, a
change over 10 000 products — within 300 s at 200 built profiles (owner ruling 2026-10-24; a full
rebuild of 202 profiles measured 274.7 s). Issue #416 tracks making the whole rebuild faster.
Measured with `PERF_RUN=true` in `backend/test/perf/price_lists/price-surface.bench.ts` (50 000
products, 1 000 organizations): the figures are in `specs/pricing/read-paths-and-performance.md` §7.

## The status sweep

`PriceListStatusWorker.sweep()` runs every five minutes in the API process (an in-process interval,
skipped while the module is absent) and moves a book's **status** — `scheduled → active` at its
start, `active → expired` at its end — for the admin's display. It decides no price: applicability
is evaluated at request time. A sweep that flips a book bumps the pricing generation. The test-only
hook is `POST /api/v1/admin/price-books/internal/sweep`.

## Admin API

Base path `/api/v1/admin/price-books`. Reads need `price_lists:read`, writes `price_lists:write`.
Schemas are in `packages/contracts/src/price-books.ts`. Every write is one `CommandBus.run` with one
audit entry on `objectType: 'price_list'` holding the state before and after; the audited actions
are `price_list.create`, `update`, `channels_replace`, `activate`, `draftify`, `expire`,
`duplicate`, `delete`, `rows_replace`, `base_prices_set` and `show_list_price_set`.

| Method and path | Purpose |
| --- | --- |
| `GET /` | The book list: `type`, `status`, `currency`, `channelId`, `audienceKind`, `memberId`, `search`, `page`, `pageSize`; with `productId` (and `variantId`) only the books with a row naming it directly, each with its `matches`. `meta.creatableAudienceKinds` says which kinds the caller may create. |
| `POST /` | Create a draft: `name`, `type`, `currencyCode`, `channelIds`, `audience { kind, memberIds }`, `priority`, `startsAt`, `endsAt`. |
| `GET /:id` | One book: header, `channels[]` with `dormant`, members, `version`, `everActivated`, `rowCount`, `tierStarts`, `writable`. |
| `PATCH /:id` | Name, priority, dates, channels, members — with `expectedVersion` in the body or an `If-Match` header. Not the currency or the type; the audience kind only before the first activation; nothing on a base book. |
| `POST /:id/activate`, `POST /:id/draftify` | Status changes. |
| `POST /:id/duplicate` | `name`, `channelIds`, `currencyCode`, `audience`, `amountMultiplier` (decimal string, default `1`): a draft copy; fixed prices and amount adjustments multiplied half-up to 4 dp, percentages verbatim. |
| `DELETE /:id` | Delete a book with its rows, members and channels; a base book is `403`. |
| `GET /:id/rows` | Rows, paged (`selectionKind`, `productId`, `variantId`, `categoryId`, `attributeKey`, `search`), each with `labels`, `naturalKey`, `inactiveReason` and `targetDeleted`. |
| `GET /:id/lines` | The grid's pages, cut by line (`kind`, `search`, `page`, `pageSize` ≤ 500), variants nested under their product, `meta.totalLines`; the cost of a page does not grow with the book. |
| `GET /:id/product-lines?productIds=` | Which of up to 200 products already have a line in the book. |
| `PUT /:id/rows` | One batch, one audited command: `{ expectedVersion, mode: 'merge' \| 'replace', upsert, delete }`, at most 5 000 rows. A row names its selection by ids (`selection`) or by natural key (`key`: `productSku`, `variantSku`, `categoryPath`, `attribute { key, valueCode }`). A row without an id whose selection and `minQuantity` equal a stored row's replaces it. |
| `PUT /:id/rows?dryRun=true` | The same body, writing nothing: `{ version, resolved, diff { added, changed, removed, unchangedCount }, errors }`. Confirm by sending the same body without `dryRun`, with the version the preview answered. |
| `GET /base-prices?productId=`, `PUT /base-prices/:productId` | A product's base prices per currency, `{ byCurrency: { CODE: { product: Tier[], variants: { [variantId]: VariantBaseRow \| null } } } }`; one command across currencies, creating a currency's base book on first use. A sales representative is `403` on the write. |
| `GET /targets/organizations?search=` or `?ids=`, `…/customer-groups`, `…/categories`, `…/attributes`, `…/sales-channels?currency=`, `…/currencies` | The pickers. Organizations are filtered to the caller's scope; attributes are only the eligible `isPriceRule` ones, with their options. |
| `POST /resolve` | The explanation: `{ salesChannelId?, currencyCode?, buyer { organizationId?, customerAccountId? }, lines [{ key, productId, variantId?, quantity }] }` (≤ 200 lines; no channel = the system default channel). Each line: `price { amount, currency, source, compareAt? }` or `null`, and `explanation { tier, cell, bookId, bookName, rowId, reference, precedenceVersion, candidates[] }`. An organization or customer the caller may not see answers the same `404` as an unknown one. |
| `GET /precedence` | The active version: `version`, `cells`, `categoryBeforeAttribute`, `depthMode`, `preset`. |
| `GET /settings/show-list-price`, `PUT /settings/show-list-price` | The `pricing.show_list_price` setting, `{ value: boolean }`; the write is one audited command. |
| `POST /internal/sweep` | Test-only: one status-sweep tick. |

Display-mode overrides keep their own paths: `GET /api/v1/admin/pricing/display-mode-overrides?scope=`,
`GET` and `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` (`{ mode }`, or
`{ mode: 'inherit' }` to remove the override).

**Versions.** `version` moves on every write to the book. `PATCH /:id` and `PUT /:id/rows` must name
the version they were made against; without one they answer `400`, against an older one
`409 PRICE_BOOK_STALE` with `details.currentVersion`, writing nothing.

**Refusals.**

| Code | Status | When |
| --- | --- | --- |
| `PRICE_BOOK_CHANNEL_CURRENCY` | 400 | a channel of the set does not offer the book's currency (the details name it) |
| `PRICE_BOOK_AUDIENCE_KIND` | 400 | members of two kinds, or a member that does not exist or is not of the kind |
| `PRICE_BOOK_IMMUTABLE_FIELD` | 409 | a change to the currency, the type, the audience kind of a book that has been active, or a base book's header |
| `PRICE_BOOK_NOT_APPLICABLE` | 409 | activation of a book with no non-dormant channel, or no member |
| `PRICE_BOOK_STALE` | 409 | a write against an older version |
| `PRICE_BOOK_ROW_OVERLAP` | 409 | every refused row overlaps another of the same selection |
| `PRICE_BOOK_ROW_SHAPE` | 400 | any other refused row (the envelope code when the errors are mixed) |
| `PRICE_BOOK_ROW_TARGET`, `PRICE_BOOK_ROW_LIMIT` | — | per-row codes inside `details.errors` (`PRICE_BOOK_ROW_LIMIT` is also the envelope code when every error is the limit) |
| `PRECEDENCE_CHANGE_UNAVAILABLE` | 409 | any write under `…/precedence` |

A refused batch lists **every** failing row in `details.errors: [{ index?, rowId?, field, code,
reason, message }]` — `index` the row's position in `upsert`, `rowId` a stored row. `reason` is one
of `PRICE_BOOK_ROW_ERROR_REASONS` (`fixed_on_all`, `rows_overlap`, `product_unknown`,
`attribute_not_selectable`, `base_book_kind`, …); it is what a client translates — the English
`message` is for logs.

**Sales-representative scope.** Read off the request's tenant context, never from the request body
(`price-book-scope.ts`): an organization book with any member outside the caller's scope answers
exactly as a missing book — `404`, absent from lists and counts — on every route; everyone and
customer-group books are read-only (`403`); a representative may create and name only organizations
in scope. `writable` on a book and `meta.creatableAudienceKinds` on the list tell a client what to
offer.

## Storefront API

| Method and path | Answers |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | For the viewer (the session's organization and customer, else a guest): `resolvedPrice { basePrice, salePrice, baseListId, saleListId, displayMode, currencyCode, quantityBracket, source, compareAt, listPrice? }`. `basePrice` is the viewer's **regular** price — buyer, catalogue or base — and `salePrice` is set only when a sale is charged; `listPrice` only when `pricing.show_list_price` is on and the everyone price is above the price charged. Amounts are decimal strings (`{ amount, currency }`). A product no book prices for the viewer is **unpriced**: `baseListId`, `basePrice` and `quantityBracket` are all `null`, never an empty-string id (`resolvedPriceEngineSchema` in `packages/contracts/src/price-lists.ts` holds the three to null together or set together). |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | The display mode alone. |

Both are resolved for the viewer and derive it through one function. A response resolved for an
organization carries `Cache-Control: private, no-store`; the anonymous one is unstamped. Catalogue
listings and search hits carry the same answer in `ProductSummary.resolvedPrice`, so the storefront
does not call `resolved-price` per card.

## Ports for other modules

| Container name | Contract (`@endora-commerce/contracts`) | What it is for |
| --- | --- | --- |
| `pricingService` | `ListingPricePort`, `ListingPriceDetailPort`, `LinePricesPort`, `ListingPriceOrderPort`, `OrgLinePricePort` | every price read (above) |
| `buyerLinePricePort` | `BuyerLinePricePort.resolveForBuyer({ buyer, salesChannelId, currencyCode?, lines })` | the net unit price a named buyer pays per line now; no authority check — the caller passes a buyer it has authorised |
| `priceListReadPort` | `PriceListReadPort` — `findById`, `findByIds`, `listAll`, `listActive`, `listForOrganization({ organizationChain, customerGroupId })` | book headers; the books that apply to an organization through its own membership, an ancestor's or its group, each with its `reason` and chain `depth` |
| `productDisplayModePort` | `ProductDisplayModePort.resolveDisplayMode` | the display mode of a product for a buyer |
| `priceBookWritePort` | `PriceBookWritePort` | a product's **base prices**, for another module's price import |

### `priceBookWritePort`

The in-process port through which another module — a PIM connector's price import — writes base
prices. The calls it replaced are mapped under *Upgrading from the old model* below.

```ts
interface PriceBookWritePort {
  basePrices(productId: string): Promise<ProductBasePrices>;
  replaceProductBaseTiers(productId: string, tiersByCurrency: Record<string, BasePriceTier[]>): Promise<ProductBasePrices>;
  replaceBasePrices(productId: string, write: BasePricesWrite): Promise<ProductBasePrices>;
  booksPricingProduct(productId: string, variantId?: string | null): Promise<PriceBookSummary[]>;
}
```

- Both writes are the admin base-price command (`PriceBookService.setBasePrices`): one Command Bus
  run (`price_list.base_prices_set`, one audit entry with the actor the Command Bus resolves in the
  caller's scope), each touched base book's version moved, the pricing generation bumped after the
  commit. `replaceProductBaseTiers` replaces the product's tiers in the named currencies and keeps
  the variants' rows; `replaceBasePrices` is exactly `PUT …/base-prices/:productId`.
- A base book is addressed by **currency**, never by id; a currency with no base book gets one
  inside the same command. Amounts are decimal strings.
- Validation and refusals are the admin API's: `400 VALIDATION_FAILED` with `details`,
  `404 NOT_FOUND` for an unknown product.
- `booksPricingProduct` is the admin list filtered by `productId`, every page, every book visible.
- It fails closed: resolving it while `price_lists` is absent throws `ModuleDisabledError`
  (`503 MODULE_DISABLED`). Resolve it per use with `lazyPort`, never hold an instance.

Rows of non-base books are written through the admin API only.

## Off-state, channels and tenancy

- `price_lists` declares `activation.nonDeactivatable`: the operator cannot switch it off. A
  deployment that does not install it makes every pricing port refuse with `MODULE_DISABLED`; the
  worker and the subscriptions are attached with `ctx.worker` and `ctx.subscribe`, so nothing of it
  runs while it is absent, and the channel bridge rows survive.
- The channel set is read and written only through `SalesChannelMembershipService`; deleting a sales
  channel clears its bindings through the kernel's channel-delete path like every other bridge.
- Deleting a currency stays refused while any book, a base book included, uses it (the module
  contributes its descriptor to the `currencyReferenceRegistry`).

## Upgrading from the old model (migration note)

This release replaced the old pricing model in one step, without a compatibility period:

| Removed | Replaced by |
| --- | --- |
| The Application rule on a price list | the book header: one currency, a channel set and an audience set |
| The per-list product roster and price brackets, and the *Default* list | the base book of each currency, holding product and variant rows |
| The price matrix tab and its organization and currency coordinates | rows of a book, for the book's audience and currency |
| The product's *Default unit price* (`defaultPrice` / `price` in `attributeValues`) | the product's base price, set on the *Pricing* tab |
| The variant price override (`product_variants.price_override`) | a variant row in a base book or any other book |
| `/api/v1/admin/price-lists-engine/…`, `/api/v1/admin/pricing/rule-targets/…`, `/api/v1/admin/products/:id/price-lists`, `/api/v1/admin/products/:id/resolved-price` | `/api/v1/admin/price-books/…` (`GET ?productId=` for the product's books, `POST /resolve` for the resolved price) |
| `priceListAdminPort` | `priceBookWritePort` |
| `listBracketMinQuantities` | `listTierStarts` |

The migrations that ran:

1. **`price_lists`, expand** (`20261021T165239_price_lists_price_books_expand.ts` and its follow-ups):
   the new tables and columns, the channel bridge, and precedence version 1 = HY.
2. **`catalog`** (`20261022T111811_catalog_price_fields_removed.ts`), which runs first by module
   order: it dropped `product_variants.price_override` and stripped `defaultPrice` and `price` from
   every product's `attribute_values`. **Neither was converted**: a variant override was never
   charged, and a product's default price only mattered for products without a *Default* bracket.
3. **`price_lists`, conversion** (`20261022T111815_price_lists_price_books_conversion.ts`), in one
   transaction, reading only its own tables and the kernel's `sales_channels`: one base book per
   currency used by a *Default*-list bracket plus the platform default currency (the default
   currency's keeps the id `00000000-0000-4000-8000-00000000d51b`); every *Default* bracket became a
   fixed product row of its currency's base book; every other price list was deleted with its
   roster, brackets, rule and matrix entries — except a list a product feed still pointed at, which
   was retired instead: rows, channel bindings and audience removed, left inactive, renamed
   `<old name> (removed by the 0.108.0 upgrade)` (`product_feeds` no longer holds a foreign key to
   `price_lists`, so the book can be deleted later and the feed then reports `not_found`); the old tables and columns were dropped; the type
   `base` was renamed `regular`.
4. **`price_lists`, after the conversion**: `20261022T182527_price_lists_product_lines.ts` creates
   `price_list_product_lines` and backfills it from the rows already stored, and
   `20261023T152351_price_lists_price_surface_targeted_marks.ts` adds the (profile, product) marks
   table `price_profile_stale_products` and `price_profiles.revision` for the targeted refresh of
   the price surface.

For the maintainers of a price import written against the removed `priceListAdminPort`:

| Removed `priceListAdminPort` call | `priceBookWritePort` replacement |
| --- | --- |
| `getById(priceListId)` | none — a base book is addressed by currency |
| `listProducts(priceListId)` | `basePrices(productId)` → `byCurrency[code].product` and `.variants` |
| `addProduct(priceListId, productId)` | none — books have no roster; writing the product's tiers is enough |
| `replaceBrackets(priceListId, productId, bracketsByCurrency)` | `replaceProductBaseTiers(productId, tiersByCurrency)`, or `replaceBasePrices(productId, { byCurrency })` |
| `summarizeBracketsForProduct(productId)` | `booksPricingProduct(productId)` |

What that means for an instance: base prices that came from the *Default* list are kept;
**every other price list is gone** and must be recreated as price books (in an instance seeded
with the demo shop, `pnpm run cli demo reset` followed by `pnpm run cli demo seed` brings back its
books); and a product that had only a *Default unit price* and no *Default*
bracket has **no price** until a base price is entered for it. Product and variant writes and the
products import now refuse `defaultPrice`, `price` and `priceOverride` with
`400 PRICE_SET_IN_PRICE_BOOKS`. The changesets of the release list every removed call with its
replacement.

## Tests

| What | Where |
| --- | --- |
| The worked-example vectors (E1–E3, precedence, sale, priority, quantity tiers, audiences, channels, surcharges, variants) | `backend/test/integration/price_lists/worked-examples/` |
| Exhaustive precedence, the resolver's order key and properties | `src/backend/services/precedence.test.ts`, `book-resolver.test.ts` |
| Every surface agrees; batch = single; sorted order = cards | `backend/test/integration/price_lists/pricing-surfaces-agree.test.ts`, `listing-prices-batch.test.ts`, `line-prices-batch.test.ts`, `price-surface-identity.test.ts` |
| Cart read = placement | `backend/test/integration/carts/cart-read-equals-placement.test.ts` |
| Admin API, scope, versions, dry run, removed routes | `backend/test/contract/price_lists/` |
| Conversion; a fresh install; the demo scenarios | `backend/test/integration/price_lists/conversion.test.ts`, `fresh-install.test.ts`, `demo-scenarios.test.ts` |
| Performance (`PERF_RUN=true`) | `backend/test/perf/price_lists/price-surface.bench.ts`, `book-resolver.bench.ts`, `book-lines-page.bench.ts`, `editor-import-save.bench.ts` |
