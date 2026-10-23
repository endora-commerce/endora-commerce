# Contract — Price surface: price sort, price range, freshness (FR-026, FR-027, SC-003, SC-005)

Design and alternatives: `research.md` R6–R7. Tables: `data-model.md` §6.

## 1. Profile resolution

`profileFor({ channelId, currencyCode, organizationChain, effectiveGroupId })`:

1. applicable buyer books = active, `starts_at ≤ now < ends_at`, `currency_code = k`, bound to the
   channel with the channel offering `k`, audience members ∩ (`organizationChain` ∪ {group});
2. vector = sorted `(bookId, audienceKind, depth)`; empty ⇒ the everyone profile;
3. id = lookup by `(channel, currency, active precedence version, sha256(vector))`.

Memoised per `(organizationId, groupId, channel, currency)` under the pricing generation.

## 2. Ordering query

`orderByUnitPrice({ context, direction, after?, amountRange?, limit, restrictToProductIds? })`:

- **stream 0** — the buyer profile's rows (absent for the everyone profile), index-ordered on
  `(profile_id, amount, product_id)`, keyset `after`, range, restriction;
- **stream 1** — the everyone profile's rows, same filters, `amount ≤ watermark(stream 0)` when stream
  0 filled its window, excluding `product_id`s present in stream 0 by a scalar `limit 1` probe;
- merge, slice `limit`; `exhausted` as today.

`pricedProductIds` = membership in stream 0 ∪ stream 1. The unpriced tail is composed by `catalog`
as today (no `defaultPrice` arm any more). Variant products sort by `amount` (the lowest variant
price), FR-026. The SQL is built in `unit-price-ordering.ts` (rewritten, same three shapes).

## 3. Profile miss and staleness — a request never waits on a build

Owner decision (2026-10-22): no request builds a surface. The order may lag a change by the worker's
turnaround (SC-005: ≤ 60 s for a targeted change, ≤ 300 s at 200 profiles for a catalogue-wide one,
§4); a displayed price never lags, because cards are always resolved live.

- **Marked profile** (a pricing write since its last build or refresh): keeps serving its surface.
  A write is a mark, not an unready state, at one of two granularities (§4): a **whole-profile
  mark** (`stale = true`, `marked_at`) or **(profile, product) marks** (rows of
  `price_profile_stale_products`). A whole-marked profile is rebuilt: the build writes the next
  generation of rows (`price_profile_prices.generation`) beside the served one and swaps
  `price_profiles.serving_generation` in the same transaction, dropping the old rows, and clears the
  mark only if no write marked the profile after the pass read it. A profile with product marks is
  refreshed in place: the marked products are re-resolved and their rows of the served generation
  replaced in one transaction under the profile's advisory lock. Both move `price_profiles.revision`,
  which keys the read path's memo of a pair of surfaces. Readers see the surface before or after
  either swap, never a mix.
- **Never-built profile** (no served surface): the request registers it (`state = 'building'`)
  and asks the worker for a build, then answers at once:
  - restricted to a bounded set (≤ 5 000 products: a category, a search result) — ordered from a
    live resolution of that set, exact;
  - unrestricted, the everyone surface of the channel and currency served — ordered from it, an
    approximation until the buyer's own surface exists;
  - unrestricted, no everyone surface either — `unordered: true` on the chunk; the catalogue serves
    its default order, cards priced live.
- The bench (§5) asserts that no request path writes the surface.

## 4. Refresh

Queue `price_lists.surface` (BullMQ), worker attached with `ctx.worker`, off when the module is off
(Principle XVII), jobs deduplicated by key:

Owner ruling 2026-10-23: the refresh is targeted per trigger. A writer describes its change as a
`SurfaceChange` (`PL/backend/services/surface-change.ts`); after the commit
`PricingGeneration.bump(change)` hands it to `PriceSurface.markChanged`, which writes every mark of
the change in one transaction. Reasoning, alternatives rejected and measurements: `research.md`
R17.

| Trigger | Marked |
| --- | --- |
| book patch (priority, dates, audience, channel set), members, activate, draftify, status flip by the sweeper | when the book was or is `active`/`scheduled`: the products its rows select, in the profiles containing it — a buyer book's profiles; an everyone book's profiles of its currency on its channels (before ∪ after); a base book's every profile of its currency. A name-only patch marks nothing |
| book create, duplicate | nothing: the new book is a draft |
| book delete | as a patch, from the rows read before the delete; the buyer profiles whose vector holds the book are dropped |
| row batch | the products the removed, replaced and written rows select, in the profiles containing the book |
| base prices (`setBasePrices`, `priceBookWritePort`) | the product, in every profile of the written currencies |
| `product.created/updated/archived/deleted.v1` | the product, in every profile |
| `category.updated.v1` | the products of the category's subtree, in every profile |
| `attribute.updated.v1` | the books with rows on the attribute, as a row change of those rows |
| `sales_channels.identity_changed`, `lifecycle_changed` | every profile of the channel, whole; with `invalidateAll`, every profile |
| organization chain or group change, customer group override | nothing: the profile memo is keyed by the chain and the group, so a moved buyer computes its new vector, which a request registers and the worker builds (§3) |
| display mode, `pricing.show_list_price` | nothing: the surface holds amounts |
| precedence version (P3) | every profile, whole |

**"In every profile" is narrowed for buyer profiles, and widened against the table this section
held before the ruling.** A buyer surface stores only the products whose answer differs from the
everyone surface's, so when an everyone-level row moves (an everyone or base book's row, a base
price, a product or category event) a buyer profile must be re-checked for the product whenever its
own books can price it — fixed rows included, not only percentages: a buyer's fixed 90 equal to the
old everyone price is stored as no row, and must become one when the everyone price moves to 100.
So such a change marks the product in the everyone profiles, and in the buyer profiles of the same
currency (and channels) **whose books may select the product or whose served surface holds a row
for it**; every other buyer answers what the everyone profile answers, before and after. The
earlier text's "the everyone profiles of that currency, for the product (and every profile whose
rows are percentages of it)" for base prices was too narrow; this is the narrowest correct set and
contains it.

**Whole-profile marks.** A change whose selection is an attribute-only or an all-products row (it
may select any product), a change concerning more than 10 000 products, a channel event and the
precedence mark their profiles whole. A marking that fails marks every profile whole.

**The worker.** One coalesced job id deduplicates the queue. A pass reads its work in one statement
— never-built and whole-marked profiles, and every (profile, product) mark with its id — and does
it: a never-built or whole-marked profile is built whole (§3); a profile with product marks has
only those products re-resolved and replaced in place (§3). Every everyone profile of the pass is
done before any buyer profile, never-built first within each, because a buyer surface is stored as
its difference from the everyone surface and must be compared with the everyone surface the pass
leaves. A whole build of a buyer profile resolves only the products its own books can select. A
pass deletes only the marks it read, by id — a mark is only ever inserted, a second write being a
second row — so a write during a pass is done by the next, and a writer and the worker never lock
the same mark. Passes repeat while a pass finds work. A whole build that writes a large share of
`price_profile_prices`, or into a table with no statistics, runs `ANALYZE` on it inside its own
transaction. SC-005's freshness bound is the worker's turnaround, measured by the bench (§5): 60 s
for a targeted change, unchanged by the ruling, and — owner ruling 2026-10-24 — ≤ 300 s at 200
built profiles for a **catalogue-wide** change, one that marks its profiles whole (an all-products or
attribute-only row on an everyone or base book, a channel identity or lifecycle event, a change over
10 000 products). Issue #416 tracks making the whole rebuild faster.

## 5. Measurement — `backend/test/perf/price_lists/price-surface.bench.ts`

Run with `PERF_RUN=true`. Fixture and scenarios as `research.md` R7 (50 000 products, 1 000
organizations, 500 with books of three kinds, 20 groups). Assertions:

| Scenario | Budget |
| --- | --- |
| first page, 50 rows, asc and desc, guest / group buyer / each org-book kind | p95 ≤ **150 ms** (SC-005) |
| price-range page, same buyers | p95 ≤ 150 ms |
| profile-miss page (restricted build) | recorded, not asserted; reported against the budget |
| single-book refresh → visible in sort | p95 ≤ **60 s** (SC-005) |
| at ≥ 200 built profiles: write → visible for an everyone row, an organization row, a base price through `priceBookWritePort`, a `product.updated.v1`; probe writes during a PIM-like import | each ≤ **60 s** (SC-005) |
| at ≥ 200 built profiles: a catalogue-wide change → visible in sort (whole rebuild of the profiles it reaches) | ≤ **300 s** (SC-005, owner ruling 2026-10-24); today only the full rebuild of every profile is recorded (274.7 s at 202), not asserted |
| full rebuild | recorded (input to P3's precedence flow) |
| `price_profile_prices` rows and index size | recorded; above 10 M rows triggers the profile-factor task (`research.md` R7) |

The listing-page budget of SC-004 is kept by the existing benches re-run on the new model:
`backend/test/perf/catalog/listing-price-viewer-cost.bench.ts` (statements and p95 against its
recorded baseline), `backend/test/perf/price_lists/resolver.bench.ts` (35 ms p95 budget) and
`matrix-resolver.bench.ts` (rewritten as `book-resolver.bench.ts`, 60 ms listing budget).
