---
title: promotions
---

# `promotions`

Cart-level discount engine (T129, T132 / FR-052). Three kinds of effect:

- `percentage_off` — `value` 0..100, applied to the cart subtotal or to
  the lines matching the optional category/product scope.
- `amount_off` — `value` is money in `currency`; capped at the relevant
  line total so the discount never pushes a line negative.
- `free_delivery` — zeros the cart's delivery cost.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/promotions` | admin (`catalog:write`) | List |
| `POST /api/v1/admin/promotions` | admin | Upsert (by `code` when present) |
| `DELETE /api/v1/admin/promotions/:id` | admin | Remove |
| `POST /api/v1/admin/promotions/preview` | admin | Apply against a CartSnapshot, return adjusted totals |

The preview endpoint accepts the `CartSnapshot` Zod schema from
`@b2b/contracts/promotions` so it can be driven by the admin UI or a
storefront preview probe with the same payload shape.

## Eligibility

A promotion is eligible for a cart when **every** filter that's set on
the row is satisfied:

- **`code`** — when present, the cart must present a matching
  `promotionCode`. When null, the promotion applies automatically.
- **`minCartSubtotal`** — cart subtotal threshold (in promotion's currency).
- **`validFrom` / `validUntil`** — clock-bound validity window.
- **`organizationId`** — restricts to a specific Customer Organization.
- **`customerGroupId`** — restricts to a specific CustomerGroup.
- **`categoryId` / `productId`** — limits the **base** the percentage /
  amount applies to: only lines matching the scope contribute.
- **`isActive=false`** — the row is silently skipped (deactivate without
  deleting).

## Application order

The service applies eligible promotions in this order:

1. Code-presented promotions first (a coupon always trumps an
   automatic).
2. Among each tier, `value` desc.

After each application the working subtotal / delivery falls; subsequent
promotions see the reduced numbers. Discounts never push subtotal or
delivery below zero.

## Output

`PromotionApplication`:

- `subtotal` — pre-discount line total.
- `discountTotal` — sum of every applied promotion amount.
- `deliveryTotal` — possibly zeroed by `free_delivery`.
- `total` = `max(0, subtotal - discountTotal) + deliveryTotal`.
- `appliedPromotions[]` — per-row audit including the underlying
  `promotionId` and `kind`.

## Entities

`Promotion` — `code?`, `name`, `kind`, `value`, `currency?`,
`minCartSubtotal?`, `validFrom?`, `validUntil?`, `organizationId?`,
`customerGroupId?`, `categoryId?`, `productId?`, `isActive`.

## Extension points

- **Stacking rules** — today every eligible promotion stacks
  sequentially. For "best-of-N" or "exclusive" semantics, add an
  `exclusivity: 'stack' | 'best' | 'exclusive'` column and adjust the
  apply loop.
- **Buy-X-get-Y** — a fourth `kind: 'bxgy'` would drop the simple
  `value` field for a JSONB rule body. The contract layer's
  discriminated union makes the change additive.
- **Per-customer redemption cap** — store every
  `(promotionId, customerAccountId)` redemption in a separate table and
  filter eligibility on count.
