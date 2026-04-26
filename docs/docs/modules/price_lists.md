---
title: price_lists
---

# `price_lists`

Pricing engine (T127, T130 / FR-050). Owns:

- **CustomerGroup** — addressable bucket of Organizations sharing pricing.
- **PriceList** — currency-scoped collection of pricing rules; one default
  list per installation, plus group + per-customer specials.
- **PriceListItem** — a single rule. Three flavours.
- **PriceListAssignment** — links a list to its audience (organization,
  customer group, or default), optionally scoped to a Sales Channel.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/customer-groups` | admin (`catalog:write`) | List groups |
| `PUT /api/v1/admin/customer-groups/:code` | admin | Upsert |
| `DELETE /api/v1/admin/customer-groups/:id` | admin | Remove |
| `GET /api/v1/admin/price-lists` | admin | List lists |
| `PUT /api/v1/admin/price-lists/:code` | admin | Upsert |
| `DELETE /api/v1/admin/price-lists/:id` | admin | Remove |
| `GET /api/v1/admin/price-lists/:id/items` | admin | List items |
| `POST /api/v1/admin/price-lists/:id/items` | admin | Create item |
| `DELETE /api/v1/admin/price-lists/:id/items/:itemId` | admin | Remove |
| `GET /api/v1/admin/price-lists/:id/assignments` | admin | List assignments |
| `POST /api/v1/admin/price-lists/:id/assignments` | admin | Create assignment |
| `DELETE /api/v1/admin/price-lists/:id/assignments/:assignmentId` | admin | Remove |
| `GET /api/v1/admin/price-lists/preview?productSku&quantity&organizationId&salesChannelCode` | admin | Resolve effective price |

## PriceListItem modes

| `mode` | Targets | Required fields | Effect |
| --- | --- | --- | --- |
| `fixed_unit` | `productId` (+ optional `variantId`) | `unitPrice`, optional `minQuantity` (default 1) | Sets the unit price outright; `minQuantity` enables volume tiers — multiple rows at different `minQuantity` thresholds are allowed |
| `percentage_off` | `categoryId` | `adjustmentValue` (0..100) | Subtracts X% from the base price for any product in the category |
| `amount_off` | `categoryId` | `adjustmentValue` (money) | Subtracts a fixed amount from the base price for any product in the category |

Volume tiers are expressed as multiple `fixed_unit` items in the same
list, each with its own `minQuantity`. The resolver picks the highest
`minQuantity` ≤ requested quantity.

## PriceListAssignment audience

Exactly one of three targeting modes per assignment row:

- `organizationId` — customer-specific list.
- `customerGroupId` — applies to every Organization carrying that
  `customerGroupId`.
- `isDefault=true` — applies to all Organizations (and anonymous traffic).

The optional `salesChannelId` further scopes the assignment to a single
Sales Channel; absent, it applies in every channel.

## Resolution algorithm

`PricingService.resolvePrice({ product, variantId?, context })`:

1. Compute the **base price** from `product.attributeValues.defaultPrice`.
2. Find every applicable assignment (org-specific + group + default,
   filtered by Sales Channel). Each assignment carries a parent
   `priceListId`.
3. For each candidate list, find the most-specific matching item:
   - **fixed_unit on the variant** beats fixed_unit on the product.
   - Within fixed_unit rows, the highest `minQuantity` ≤ requested
     `quantity` wins (volume tier).
   - **percentage_off / amount_off on a category** the product belongs
     to applies on top of the base price; we take the most generous of
     any one adjustment (never stack).
4. Return the **lowest non-negative computed price** across all
   candidate lists ("most favourable to the Customer", FR-050 default
   tiebreaker). When no list matches, fall back to the base price.

The resolver never returns a negative price; an `amount_off` adjustment
that would underflow zero is dropped from the candidate set.

## Entities

`CustomerGroup`, `PriceList`, `PriceListItem`, `PriceListAssignment`.
Migration 014 also adds `organizations.customer_group_id` (nullable) so
the existing organizations table doesn't change shape unless an admin
buckets a customer.

## Extension points

- **Configurable conflict policy** (FR-050) — today the resolver always
  picks the lowest. A `PriceList.conflictPolicy: 'lowest' | 'highest_priority'`
  knob would expose the spec's "configurable in the Admin Panel" lever.
- **Validity windows** — assignments could carry `validFrom` /
  `validUntil` to model promotional time windows; the resolver would
  filter out expired rows before step 3.
- **Stacking adjustments** — for a "5% group + 10% category" stack,
  introduce an `applyOrder` enum on PriceListItem and walk the list of
  matching adjustments in the configured order.
- **Currency normalisation** — when a list's currency differs from the
  Sales Channel's default currency, the resolver currently keeps the
  channel currency on the result. A pluggable FX hook would convert
  list-currency prices into channel currency.
