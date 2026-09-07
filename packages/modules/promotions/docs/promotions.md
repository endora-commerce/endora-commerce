---
title: promotions
description: Cart-level percentage / amount / free-delivery discounts with eligibility filters
---

# `promotions`

The promotions module is a configurable, rule-driven discount engine
(feature 045, built on the original cart-discount slice). A **Promotion**
pairs an eligibility **Rule** with an **Action**; the engine evaluates every
active promotion against a cart, applies the matching ones in priority order,
and surfaces the result in the cart and on the placed order.

## Concepts

- **Rule** — a typed AST (`all` | `condition` | `group`) over built-in cart
  fields (cart total, payment method, delivery method, delivery country,
  delivery postal code, organization, customer group, product category) and
  promo-eligible product attributes. Conditions carry an operator
  (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`between`/`in`/`notIn`/`contains`/
  `startsWith`) and values; groups combine children with `AND`/`OR` (max depth
  5). A rule may be authored inline or referenced from the **named-rule**
  library (`promotion_rules`).
- **Action** — one configured effect from the registry. Built-ins:
  `free_delivery`, `percentage_off_cart`, `amount_off_cart`,
  `buy_x_get_y_free` (cheapest/most-expensive target), `spend_x_percent_off`,
  `spend_x_amount_off`, `every_nth_product_percent_off`, `buy_x_units_y_free`,
  `buy_x_units_percent_off`, `buy_x_units_amount_off`. Other modules register
  additional action types via `PromotionActionRegistry.register(...)`.
- **Priority & stacking** — eligible promotions apply in `priority` DESC order
  (deterministic tie-break: `createdAt`, then `id`). A promotion flagged
  `stopFurther` halts any lower-priority promotion. Discounts never push a
  line, subtotal, delivery, or total below zero.
- **Coupons** — a promotion may carry coupons (`promotion_coupons`): a single
  specified code or a generated batch (`coupon_batches`). A couponed promotion
  applies only when a matching code is presented. The legacy `promotions.code`
  column is still honored.
- **Usage limits** — optional global / per-organization / per-customer caps.
  Coupon batches choose `per_coupon` vs `shared_batch` scoping for the global
  pool. Usage is counted only on successful order placement.
- **Statistics** — `promotion_usages` records each finalized redemption with
  denormalized dimensions, aggregated into totals + breakdowns by customer,
  customer group, organization, and sales channel.

## Application flow

1. `PromotionService.applyToCart(snapshot)` loads active promotions, resolves
   any presented coupon code, soft-excludes exhausted promotions, evaluates
   each rule, runs the action through the registry against running totals, and
   returns the adjusted totals plus a per-promotion breakdown.
2. The cart read path calls this on every read so the cart shows the real
   discount amount and `appliedPromotions[]`.
3. On order placement, the order service recomputes the application, stamps
   `order_applied_promotions` + `orders.discount_total`, and **finalizes
   usage** inside the placement transaction.

## Usage finalization (race-safe)

`finalizeUsage` runs inside the order-placement transaction. Each applicable
scope counter is bumped with `UPDATE promotion_usage_counters SET count =
count + 1 WHERE (scope_type, scope_key) = … AND count < :limit`. Zero rows
affected means the cap was reached, so a `409 promotion_unavailable` is thrown
and the whole placement rolls back. Two carts racing for the final use can
never both succeed.

## Public surface (admin, gated by `promotions:read|write|delete`)

| Verb + Path | Purpose |
| --- | --- |
| `GET/POST/PUT/DELETE /api/v1/admin/promotions[/:id]` | Promotion CRUD |
| `GET /api/v1/admin/promotions/action-types` | Action catalogue for the editor |
| `GET /api/v1/admin/promotions/rule-targets/attributes` | Promo-eligible attributes |
| `POST /api/v1/admin/promotions/preview` | Apply against a `CartSnapshot` |
| `GET/POST /api/v1/admin/promotions/:id/coupons` | Single-coupon management |
| `POST /api/v1/admin/promotions/:id/coupon-batches` | Bulk generator |
| `GET .../coupon-batches/:batchId/export` | CSV export of generated codes |
| `GET /api/v1/admin/promotions/:id/stats` | Usage statistics |
| `GET/POST/PUT/DELETE /api/v1/admin/promotion-rules[/:id]` | Named-rule library |

Coupon redemption on the storefront flows through the existing cart coupon
endpoints (`POST /api/v1/cart/coupon`), which resolve the code via the coupon
table or the legacy column.

## Permissions

- `promotions:read` — view promotions, rules, coupons, statistics.
- `promotions:write` — create + edit promotions and rules, manage coupons.
- `promotions:delete` — delete promotions and rules.

## Performance note

Cart pricing loads active promotions with a single indexed query plus a
coupon/counters lookup. At the platform's target scale this is sufficient; a
Redis per-channel candidate cache (invalidated via the module-lifecycle
pub/sub channel) is the documented next optimization if profiling shows the
per-request load becomes hot — deliberately deferred under YAGNI until then.
