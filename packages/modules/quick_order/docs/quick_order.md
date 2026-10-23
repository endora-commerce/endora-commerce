---
title: quick_order
description: CSV-import + type-ahead helpers for buyers ordering by SKU
---

# `quick_order`

The platform's **quick-ordering toolkit**.
It bundles several conveniences that let B2B buyers place repeat and
high-volume orders with the fewest steps, reusing the existing Cart, Quote
Request, Order/Checkout, Organization, Payment/Shipping method, Catalog, and
Settings capabilities rather than introducing a parallel ordering engine.

## Capabilities

### 1. CSV / Excel import → Cart or Quote Request

`POST /api/v1/quick-order/import` accepts a pasted CSV (`csv`) **or** an
uploaded CSV / `.xlsx` file (`file: { filename, contentBase64 }`). Both are
normalized to the same row model and validated against the catalog:

- Required columns `sku` + `quantity` (header row, order-independent,
  case-insensitive). Any other column is treated as a **variant attribute
  value** and resolved against the parent product's variant-axis attributes —
  a row resolves only when exactly one purchasable variant matches.
- The response partitions rows into `recognized` + `rejected` (each with a
  per-row reason: `sku_missing`, `quantity_invalid`, `product_not_found`,
  `product_archived`, `malformed_row`, `variant_not_resolved`,
  `variant_ambiguous`, `row_limit_exceeded`, `below_minimum`) plus a `summary`.
- Duplicate SKUs are merged (quantities summed); rows beyond
  `quick_order.import_max_rows` are rejected. The setting is clamped to
  **1–10 000** whatever its stored value.

`POST /api/v1/quick-order/build` turns the confirmed recognized rows into a
**Cart** (`CartService`) or a **Quote Request** (`RfqService`), priced at the
buyer's current prices from the price books — the basket's own pricing for a
cart, the quote request's reference prices for a request. The admin twins
(`/api/v1/admin/quick-order/import` + `/build`, guarded by `orders:write`)
build on behalf of a chosen customer via `onBehalfOf`.

**Order minimums in the file.** The preview judges each product's minimum in
pieces on the product's **total across the whole file** — duplicate rows
merged, then every variant of the product summed — never together with the
buyer's cart, so the preview's verdict and the build's may differ. Rows
rejected for another reason count toward no total.

- On the **buyer's** import, every row of a product whose file total is below
  its minimum is rejected with `below_minimum`, the `minimum` and the
  `productTotal` the verdict used.
- On the **operator's** import (admin route) such a row stays in `recognized`
  with `warning: { reason: 'below_minimum', minimum, productTotal }`, and the
  summary counts it in `warningCount`. The on-behalf screen badges the row and
  still builds it — into a quote request as is, into a cart subject to the
  cart's check.

**The build.** A build of more than **200** items is refused whole with
`422 VALIDATION_FAILED`, `details: { code: 'too_many_items', maximum: 200 }`,
before anything else, for both targets and for buyer and operator alike.

- Target `cart` adds the items as one batch judged together with the cart: the
  lines that meet their minimums are added, the others are listed in
  `rejected[]` (`reason: 'below_minimum'`, the `kind`, the `minimum`, and
  `packagingUnitName` for a packaging-unit minimum). A product the customer
  may not see, or that the channel does not publish, fails the build as an
  unknown product before anything is added.
- Target `quote_request` is one quote request, not a batch: a buyer's build is
  refused below a minimum like any customer quote request, an operator's build
  is written with the lines flagged for the sales team (the Quote Requests
  module's page).

`.xlsx` parsing uses **`exceljs`** (backend-only, isolated to
`excel-importer.ts`); only the first worksheet is read.

### 2. Quick search

`GET /api/v1/quick-order/search?q=` matches by SKU, product name, and the
values of attributes flagged **`quick_searchable`** (an independent boolean on
`product_attributes`, toggled in the admin Attributes manager). Values of
non-flagged attributes never match. Session-gated; channel-scoped.

### 3. Default ordering preferences

`quick_order_default_preferences` stores four defaults — payment method,
delivery method, billing address, shipping address — per target
(`scope` = `organization` | `customer`). Resolution is most-specific-wins
(customer overrides organization, per field) with a use-time eligibility
re-check (active / org-allowed / address exists → otherwise dropped to null).

- Storefront: a customer manages their own defaults (`/preferences`); checkout
  pre-selects the resolved defaults.
- Admin: `/api/v1/admin/quick-order/preferences` — a platform admin manages any
  scope; a salesperson only their assigned organizations and those orgs'
  customers. Every change is audited.

### 4. Reorder

"Order again" on a past order produces either a new Cart
(`POST /orders/:id/reorder`) or a new Quote Request
(`POST /orders/:id/clone-to-quote`) at current prices, reporting unavailable
lines and respecting the `orders.reorder_enabled` setting.

### 5. One-click buy

When `quick_order.one_click_buy_enabled` is on for the buyer's sales channel
**and** the buyer has all four eligible defaults, the product page shows a
"Buy in one click" button. It skips Cart and Checkout: the order is placed from
the defaults and the buyer is routed by the payment `nextAction` (gateway
redirect, or the order / success page when no payment step is required).

The product becomes the buyer's whole basket through the cart's `addItems`
with `replaceExisting: true` and `onBelowMinimum: 'throw'`, then
`OrderService.placeOrder` places it. `addItems` empties the basket only once
nothing is left to refuse the line for, so a line refused before the write —
below its minimum order quantity, without a price, or quote-only — leaves the
basket exactly as it was. A refusal at placement, after the line was written
(stock, the organization, a payment or delivery method), leaves the basket
holding that one one-click line.

Same validations as a normal order (org active, minimum value, credit limit,
stock, minimum order quantity). For a `simple` or `configurable` product with
a minimum order quantity, one click orders that minimum instead of 1.

## Settings

| Code | Type | Default | Scope |
|------|------|---------|-------|
| `quick_order.one_click_buy_enabled` | boolean | `false` | per sales channel |
| `quick_order.import_max_rows` | number | `2000` (clamped to 1–10 000) | global |

## Data

- New table `quick_order_default_preferences` (migration `20260611T140359_quick_order_default_preferences.ts`).
- New column `product_attributes.quick_searchable` (migration `20260611T140400_catalog_attribute_quick_searchable.ts`, owned
  by `catalog`).

## Dependencies

Builds on `orders` (Core ordering engine), `carts`, `quote_requests`,
`organizations`, `payment_methods`, `delivery_methods`, `catalog`, `addresses`,
and `settings`. The `orders` module does **not** depend on `quick_order`; the
one-click flow receives `OrderService` through a lazy getter wired in
composition.
