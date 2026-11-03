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

- a **name** (operator text, e.g. `Paleta`, `Karton`) — the Global name is unique within
  the product; a channel or a channel and language can override it (see *Name per scope* below),
- a **base quantity** (whole number ≥ 1) — how many base pieces the unit holds,
- a **default** flag — the unit pre-selected on the storefront,
- a **position** — the order units appear in,
- an optional **minimum** — the fewest of this unit a buyer may order at once
  (whole number from 1 to 1 000 000; empty for none).

## Minimum number of units

A unit's minimum is counted over **every line of the product ordered in that
unit**, across all variants: a line counts its pieces divided by the unit's
base quantity. Pallet minimum 2 is met by one line of 2 pallets, or by two
lines of 1 pallet of different variants. It is independent of the product's
minimum in pieces (set in the product's **Order rules** card): both may be set,
and an order must satisfy each. Pieces ordered singly or in another unit do not
count toward this unit's minimum, but every line counts toward the pieces
minimum.

A basket, quote request or order that leaves a unit below its minimum is
refused with `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, whose message names
the product, the minimum and the unit. The storefront starts the quantity at
the selected unit's minimum. The admin's Create order screen and the external
order API carry no packaging unit, so only the pieces minimum is reachable
there.

On a quote request a line names its unit by `packagingUnitId`; the server
stores the catalogue's name and base quantity for it. A line that sends a
packaging name and base quantity without an id is accepted only when both
match one of the product's units. Anything else is refused with
`422 PACKAGING_UNIT_MISMATCH` — an id that is unknown, deleted or another
product's unit all give the same reason.

**For API clients:** a name sent without an id is matched against the unit's
**Global** name only, never against a channel's or a language's name (see *Name per
scope*). A line that sends the name a buyer saw in a translated storefront — `Pallet`
where the Global name is `Paleta` — is refused with
`422 PACKAGING_UNIT_MISMATCH` (reason `name_unknown`). Send the
`packagingUnitId`, or the Global name.

## Name per scope

A unit's name is a scoped field: it has a Global value and can be overridden at a sales
channel or at a channel and language. It is saved with the rest of the scope by
`PUT …/products/:id/scoped-values`, e.g.
`{ "changes": { "packagingUnits": { "<unitId>": { "name": "Pallet" } } } }` at
`{ "channelId": "…", "languageCode": "en-US" }`. Each name is at most 160 characters;
`{ "inherit": true }` removes the scope's own name, and `null` stores a deliberately
empty name at a channel or a channel and language. The Global name cannot be empty. It
is the one that must be unique within the product, the one a quote line sent without
an id is matched against, and the one minimum refusals name.

Where a buyer sees the unit, its name is the effective name at the request's channel and
language — Channel × language → Channel → Global:

- the product page's `packagingUnits[].name`;
- the name a basket line snapshots — at the basket's channel and language. When
  an administrator names the channel on a customer's behalf, the name is taken in
  that channel's default language, like the product name beside it;
- the name a buyer's quote-request line snapshots — at the channel and language the
  request is raised in.

A deliberately empty name at the scope does not produce an unnamed line: the basket,
quote and order snapshots then keep the Global name.

Creating or updating a unit is recorded once in the audit log, as
`packaging_unit.create` or `packaging_unit.update`, with the unit's state before and
after (its product, Global name, base quantity, default flag and minimum). Sending the
recorded before-state back through the same route (without `productId`) restores it.
A scoped save is recorded as `product.scoped_values.save`. Both announce
`product.updated.v1`. A request that changes nothing writes nothing and announces
nothing. Deleting a unit removes its overrides at every scope.

## For buyers

On the product page a selector offers the available units plus a *single piece*
option. Ordering a unit adds `baseQuantity × units` pieces to the cart as one
line, whose displayed name gets the unit appended — e.g.
`Łożysko 6205-2RS (Paleta)`. A packaging-unit line and a plain single-piece
line of the same product stay separate.

## How the label travels

The unit name and base quantity are **snapshotted** on the line when it is
created — the effective name at the line's channel and language, as above — so later edits to (or deletion of) a product's packaging units never
change historical carts, orders, or quote requests.

- **Cart** — `cart_items` snapshot the unit; the cart serializer composes a
  `displayName` with the suffix.
- **Order** — `order_items` get a `packaging_unit_snapshot`, and the unit name
  is appended to `product_snapshot.name`, so every order document (detail,
  invoice, CSV, email) shows it.
- **Quote request** — `quote_request_items` snapshot the unit and append it to
  `product_name`; cart → quote-request conversion carries the context through.

## Pricing & availability

A line in a packaging unit is priced by the price books on the resulting
base-piece quantity (including the books' quantity tiers) — there is no
separate per-unit price.
Stock availability and per-line limits are evaluated on the resulting piece
count.

## API surface

- Admin CRUD: `GET/POST /api/v1/admin/catalog/products/:id/packaging-units`,
  `PATCH/DELETE …/:unitId`, `PATCH …/packaging-units/reorder`
  (gated by `catalog:read` / `catalog:write`). Create takes the Global name; update
  takes the base quantity, default flag, position and an optional `minOrderUnits`
  (`1…1000000`, or `null` to clear) — the name at any scope is written through
  `PUT …/scoped-values`. The response always carries `minOrderUnits`. The in-process `CatalogPackagingPort`, used by PIM
  connectors, accepts the same optional field and refuses an out-of-range
  value with `422 VALIDATION_FAILED`; a writer that never sends it keeps
  working.
- Public: the product detail (`GET /api/v1/catalog/products/:idOrSlug`)
  includes an optional `packagingUnits` array; each unit carries its effective
  name at the request's channel and language and `minOrderUnits` (`null` when none).
- Cart: `POST /api/v1/cart/items` accepts an optional `packagingUnitId`; the
  resulting line quantity is `baseQuantity × quantity`.

## Schema

Table `product_packaging_units` (migration
`20260611T140412_catalog_product_packaging_units.ts`): `id`, `product_id`
(FK → `products`, cascade delete), `name`, `base_quantity`
(`CHECK >= 1`), `position`, `is_default`, timestamps; `UNIQUE (product_id,
name)`. Migration `20261016T082008_catalog_order_rules.ts` adds
`min_order_units` (nullable, `CHECK` 1–1 000 000).
`20261030T113908_catalog_scope_model_media.ts` replaces the per-language
`name_translations` with `product_packaging_unit_scope_overrides`: a name at a
channel or a channel and language, referencing the unit together with its product
and cascading on the unit's, the product's and the channel's delete. Additive snapshot columns, each added by its owning module:
`cart_items` (`20260611T140413_carts_cart_item_packaging.ts`), `order_items`
(`20260611T140414_orders_order_item_packaging.ts`), `quote_request_items`
(`20260611T140415_quote_requests_qr_item_packaging.ts`; its
`packaging_unit_id` from
`20261018T122118_quote_requests_item_packaging_unit_id.ts`).
