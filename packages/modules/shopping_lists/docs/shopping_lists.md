---
title: shopping_lists
description: Per-customer named bundles convertible to Cart or RFQ
---

# `shopping_lists`

Per-customer named bundles of (product, variant?, quantity, note?) rows.
Buyers save recurring orders, then convert all or a selected subset of
items into a Cart or a draft Quote Request in a single click. Conversions
skip archived products and report them rather than failing the whole batch.

## Public surface

All endpoints require an authenticated customer session and are scoped to
the `(customer, organization)` pair on the session.

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/shopping-lists` | List the buyer's lists with their items |
| `POST /api/v1/shopping-lists` | Create a new list |
| `GET /api/v1/shopping-lists/:id` | One list with its items |
| `PATCH /api/v1/shopping-lists/:id` | Rename |
| `DELETE /api/v1/shopping-lists/:id` | Delete (cascades to items) |
| `POST /api/v1/shopping-lists/:id/items` | Add an item |
| `PATCH /api/v1/shopping-lists/:id/items/:itemId` | Update quantity / note |
| `DELETE /api/v1/shopping-lists/:id/items/:itemId` | Remove |
| `POST /api/v1/shopping-lists/:id/convert-to-cart` | Add items to the active cart; archived rows are skipped + reported |
| `POST /api/v1/shopping-lists/:id/convert-to-rfq` | Add items to the draft RFQ; returns the `rfqId` for deep-linking |

The two converters accept an optional `itemIds: string[]` body. Empty or
missing array means "convert every item on the list".

The default list has its own three routes: `GET /api/v1/shopping-lists/default`
(created on first read when missing), `POST /api/v1/shopping-lists/default/items`
and `POST /api/v1/shopping-lists/:id/set-default`.

## Organization permissions

The module declares two organization permissions, which an Organization's
administrator grants per role (`organizations`). Both are member-default, so an
Organization's *Member* role holds them from the start and nothing changes for
existing members.

| Code | Label | Gates |
| --- | --- | --- |
| `shopping_lists.create` | Create and edit shopping lists | `POST /api/v1/shopping-lists`, `PATCH` / `DELETE …/:id`, `POST …/:id/items`, `PATCH` / `DELETE …/:id/items/:itemId`, `DELETE …/:id/items`, `POST …/default/items`, `POST …/:id/set-default` |
| `shopping_lists.convert` | Convert shopping lists into quote requests and carts | `POST …/:id/convert-to-cart` (with `carts.create`), `POST …/:id/convert-to-rfq` (with `quote_requests.create`) |

- **Reading stays open.** Listing one's own lists, reading one, and reading the
  default list need no permission.
- **A conversion needs two permissions**: `shopping_lists.convert` and the
  target's create permission, which `carts` and `quote_requests` declare. They
  are two separate checks, judged in that order; a refusal names the first one
  missing.
- **A refusal** is `403 ORGANIZATION_PERMISSION_REQUIRED` with the code and its
  translated label in `details`, answered before the request body or the list
  is looked at.
- **Saving a cart line to a list** (`POST /api/v1/cart/items/:itemId/save-to-shopping-list`)
  is a `carts` route; it needs `shopping_lists.create` too.
- **The default list is still provisioned** for every new member of an
  Organization, whatever their role: it is the platform's, not a write of the
  member's.
- **Switched off**, the module takes both permissions off the role editor and
  off every member's effective permissions; the grants stay stored and apply
  again once it is switched back on.

On the storefront a member without `shopping_lists.create` still reads their
lists. The lists page and a list's page offer no create, rename, delete,
quantity or remove controls; *Add to shopping list* is not offered on the
product page or the product cards, nor *Save to list* on a cart line. The page says why in one line: *"Your
role allows viewing shopping lists but not changing them."* Converting a list
(all lines or the selected ones) into the cart is offered only with
`shopping_lists.convert` and `carts.create`, and into a quote request only with
`shopping_lists.convert` and `quote_requests.create`.

## Conversion semantics

`ShoppingListService` partitions the requested items by their referencing
product's status:

- `active` products go into the cart as one batch through the cart's
  `addItems` (judged together with the cart, so the minimum order quantities
  apply), and into the RFQ via `RfqService.createForCustomer`, whose
  customer-write minimum check applies.
- `archived` products (or rows whose product no longer exists) are
  reported in `skipped[]` with one of:
  - `product_archived`
  - `product_not_found`
  - `variant_unavailable`
  - `below_minimum` (cart only) — the product's total in the cart after the
    conversion would stay below a minimum order quantity; the skip carries the
    `minimum` the line missed.

A product the buyer may no longer see, or that the channel does not publish,
is skipped as `product_not_found` — exactly like a deleted product, with no
name or minimum. Every other line is still added; the conversion is not rolled
back.

The HTTP response is always `200 OK` with `{ added, skipped }` so the UI
can show a friendly message rather than treating the partial result as
an error.

## Entities

`ShoppingList` — `(organizationId, customerAccountId, name)`.

`ShoppingListItem` — cascade-deletes with its parent list. The FK to
`products` is intentionally a plain uuid column without a CASCADE so a
product archive doesn't drop historical rows; the conversion service
surfaces them in the skip report instead.

## Extension points

- **Sharing within an organization** — the entity has no `isShared`
  column today; adding org-wide sharing means a column flip plus a
  one-line tweak to `#owned()` in `shopping-list-service.ts`.
- **Per-list deadlines** — extend `ShoppingList` with `expiresAt` for
  procurement workflows that auto-archive stale lists.
- **Convert-to-quote-only-mode** — the converter already returns an RFQ
  id; the storefront can deep-link the buyer into the draft to add a
  requester note before submission.
