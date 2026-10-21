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

## 3. Profile miss

A request whose profile is not `ready`: build it synchronously for `restrictToProductIds` (bounded by
the category or search id set) inside the request, mark the rest `building`, enqueue the full build.
The answer is exact; the bench (§5) measures the miss path separately.

## 4. Refresh

Queue `price_lists.surface` (BullMQ), worker attached with `ctx.worker`, off when the module is off
(Principle XVII), jobs deduplicated by key:

| Trigger | Job |
| --- | --- |
| book create/patch/activate/draftify/delete, channel set, members | rebuild the profiles containing the book; create/retire profiles whose vector changes |
| row batch | the profiles containing the book, for the products the rows select |
| base prices | the everyone profiles of that currency, for the product (and every profile whose rows are percentages of it) |
| `product.*.v1`, `category.updated.v1`, `attribute.updated.v1` | the products concerned, in every profile |
| organization chain or group change, customer group override | profile vectors of the affected buyers (memo invalidation; rows only if a new vector appears) |
| status flip by the sweeper / a start or end instant | the profiles containing the book |
| precedence version (P3) | full rebuild under the new version, beside the old |

A refresh writes its rows in one transaction, flips `state` to `ready`, and bumps `PricingGeneration`.
SC-005's freshness bound (60 s) is the queue's p95 latency, measured by the bench.

## 5. Measurement — `backend/test/perf/price_lists/price-surface.bench.ts`

Run with `PERF_RUN=true`. Fixture and scenarios as `research.md` R7 (50 000 products, 1 000
organizations, 500 with books of three kinds, 20 groups). Assertions:

| Scenario | Budget |
| --- | --- |
| first page, 50 rows, asc and desc, guest / group buyer / each org-book kind | p95 ≤ **150 ms** (SC-005) |
| price-range page, same buyers | p95 ≤ 150 ms |
| profile-miss page (restricted build) | recorded, not asserted; reported against the budget |
| single-book refresh → visible in sort | p95 ≤ **60 s** (SC-005) |
| full rebuild | recorded (input to P3's precedence flow) |
| `price_profile_prices` rows and index size | recorded; above 10 M rows triggers the profile-factor task (`research.md` R7) |

The listing-page budget of SC-004 is kept by the existing benches re-run on the new model:
`backend/test/perf/catalog/listing-price-viewer-cost.bench.ts` (statements and p95 against its
recorded baseline), `backend/test/perf/price_lists/resolver.bench.ts` (35 ms p95 budget) and
`matrix-resolver.bench.ts` (rewritten as `book-resolver.bench.ts`, 60 ms listing budget).
