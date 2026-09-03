---
title: Packaging Units
---

# Packaging Units

Named ordering units attached to a product — for example a **Paleta** worth
480 pieces. They let B2B buyers order in bulk units without typing the exact
piece count, and carry that context all the way into the order and quote
request.

## For operators

Manage packaging units in the **Inventory** section of the product card
(simple and configurable products only). Each unit has:

- a **name** (operator text, e.g. `Paleta`, `Karton`) — unique within the product,
- a **base quantity** (whole number ≥ 1) — how many base pieces the unit holds,
- a **default** flag — the unit pre-selected on the storefront,
- a **position** — the order units appear in.

## For buyers

On the product page a selector offers the available units plus a *single piece*
option. Ordering a unit adds `baseQuantity × units` pieces to the cart as one
line, whose displayed name gets the unit appended — e.g.
`Łożysko 6205-2RS (Paleta)`. A packaging-unit line and a plain single-piece
line of the same product stay separate.

## How the label travels

The unit name and base quantity are **snapshotted** on the line when it is
created, so later edits to (or deletion of) a product's packaging units never
change historical carts, orders, or quote requests.

- **Cart** — `cart_items` snapshot the unit; the cart serializer composes a
  `displayName` with the suffix.
- **Order** — `order_items` get a `packaging_unit_snapshot`, and the unit name
  is appended to `product_snapshot.name`, so every order document (detail,
  invoice, CSV, email) shows it.
- **Quote request** — `quote_request_items` snapshot the unit and append it to
  `product_name`; cart → quote-request conversion carries the context through.

## Pricing & availability

Pricing reuses the existing engine on the resulting base-piece quantity
(including price-list quantity tiers) — there is no separate per-unit price.
Stock availability and per-line limits are evaluated on the resulting piece
count.

## API surface

- Admin CRUD: `GET/POST /api/v1/admin/catalog/products/:id/packaging-units`,
  `PATCH/DELETE …/:unitId`, `PATCH …/packaging-units/reorder`
  (gated by `catalog:read` / `catalog:write`).
- Public: the product detail (`GET /api/v1/catalog/products/:idOrSlug`)
  includes an optional `packagingUnits` array.
- Cart: `POST /api/v1/cart/items` accepts an optional `packagingUnitId`; the
  resulting line quantity is `baseQuantity × quantity`.

## Schema

Table `product_packaging_units` (migration 068): `id`, `product_id`
(FK → `products`, cascade delete), `name`, `base_quantity`
(`CHECK >= 1`), `position`, `is_default`, timestamps; `UNIQUE (product_id,
name)`. Additive snapshot columns: `cart_items` (069), `order_items` (070),
`quote_request_items` (071).
