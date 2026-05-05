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
| `POST /api/v1/admin/promotions` | admin | Upsert (by `code` when present); accepts `criteria[]` (feature 012 / US8) |
| `DELETE /api/v1/admin/promotions/:id` | admin | Remove |
| `POST /api/v1/admin/promotions/preview` | admin | Apply against a CartSnapshot, return adjusted totals |
| `GET /api/v1/admin/promotions/rule-targets/attributes` | admin | List every `isPromoRule = true` attribute with its options inline; feeds the rule editor's criterion picker (feature 012 / US8) |

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
- **`criteria[]`** (feature 012 / US8) — line-level discriminated criteria
  ANDed with `categoryId` / `productId`. A line contributes to `lineBase`
  only if it satisfies both the legacy scope and every criterion.
- **`isActive=false`** — the row is silently skipped (deactivate without
  deleting).

## Criteria (feature 012 / US8)

`criteria[]` is a JSONB column on `promotions`. Each entry is a
discriminated union:

| `type` | Meaning |
| --- | --- |
| `attribute` | Match against a product's `attributeValues[key]` per the operator vocabulary below |
| `category` / `product` / `customerGroup` / `organization` | Reserved for future migration of the flat fields into the criteria array |

For `type: 'attribute'` the operator vocabulary depends on the attribute's
`valueType`:

| `valueType` | Allowed `op` | `values` shape |
| --- | --- | --- |
| `string` | `equals`, `in` | `string[]` |
| `select`, `enum` | `equals`, `in` | `string[]` of option `value`s; every value must exist in the attribute's option list |
| `multiselect` | `in` | `string[]`; matches if any of the product's selected values is in `values` |
| `number`, `price` | `equals`, `range` | `equals`: `[number]`; `range`: `[min, max]` (inclusive) |
| `boolean` | `equals` | `[boolean]` |
| `date` | `equals`, `range` | `[isoDateTime]` / `[from, to]` |

Server-side validation errors for write-time criterion checks:

- `400 attribute_not_found` — referenced attribute does not exist
- `400 attribute_not_promo_eligible` — referenced attribute has `isPromoRule = false`
- `400 invalid_criterion_op` — `op` not in the valueType's allowed list
- `400 invalid_criterion_values` — values shape mismatch
- `400 invalid_option_value` — for select-style criteria, a value is not in the option list

## Skip-on-toggle (FR-039)

When an attribute's `isPromoRule` flips off after rules are authored, every
existing criterion that references its key is silently skipped on the next
resolution (treated as `false`). The decision is logged at `info` with
`{ promotionId, criterionAttributeKey, reason: 'attribute_not_promo_eligible' }`
so an operator can debug a "rule stopped working" report. Re-flipping the
flag back on resumes matching with no editor changes.

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
`customerGroupId?`, `categoryId?`, `productId?`, `criteria[]`, `isActive`.

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
