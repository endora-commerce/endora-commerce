---
title: carts
---

# `carts`

Anonymous and customer-bound shopping carts. An anonymous cart is
identified by a long-lived cookie token; on login it merges into the
Customer's cart deterministically.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/cart` | Active cart (lazy-create) |
| `POST /api/v1/cart/items` | Add line item |
| `PATCH /api/v1/cart/items/:itemId` | Update quantity |
| `DELETE /api/v1/cart/items/:itemId` | Remove |
| `POST /api/v1/cart/clear` | Empty cart |

## Merge-on-login

`cart-service.ts#mergeAnonymousIntoCustomer()` is invoked by the `auth`
module's `onLogin` hook. Conflicting line items combine quantities; the
anonymous cart cookie is invalidated atomically.

## Entities

`Cart` (one per actor at most), `CartItem`. Active-cart uniqueness is
enforced by partial unique index keyed on either `customer_account_id` or
`anonymous_token`.

## Extension points

- **Pricing recalc cadence** — Cart never stores prices long-term; the
  `pricing-service.ts` (when shipped) is consulted on every render.
- **Cart abandonment** — emit a domain event from
  `cart-service.ts#addItem` and have a worker run the recovery flow.
