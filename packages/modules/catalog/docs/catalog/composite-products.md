---
title: Composite Products
---

# Composite Products: grouped, bundle, virtual

Feature 002 introduces three product types beyond `simple` /
`configurable`. Each carries a type-discriminated payload on the PDP
and renders a dedicated component in the storefront's action zone.

## Types

### Grouped

A parent product with a fixed list of child products at fixed
quantities. The buyer cannot configure which children — they buy the
whole set. Use case: "Starter kit" SKU that bundles two simple
products at quantities 2 and 1.

### Bundle

A parent product with named slots, each with min / max quantity ranges
and one or more option products to choose between. Use case:
configurable workstation where the buyer picks a CPU (slot, min=1
max=1) and add-on accessories (slot, min=0 max=3).

### Virtual

A digital product with `downloadAssetId` (server-hosted file) **or**
`downloadUrl` (external link) — exactly one of the two MUST be set
(Zod refine + service-layer guard). Use case: e-book PDF, license key
fulfilment, link to a third-party download portal.

## No nested composites (research R-8)

A grouped product cannot include another grouped or bundle product as
a child. A bundle's slot options cannot be grouped or bundle products
either. The rule is enforced at the service layer because PostgreSQL
CHECK constraints cannot JOIN `products` to inspect the foreign row's
`type`. Surfaces as `NESTED_COMPOSITE_NOT_ALLOWED` (400).

## Public surface

### Admin

| Verb + Path | Purpose |
| --- | --- |
| `GET / POST / PATCH / DELETE /products/:id/grouped-items[/:itemId]` | Grouped CRUD |
| `GET / POST / PATCH / DELETE /products/:id/bundle-slots[/:slotId]` | Bundle slot CRUD |
| `POST / DELETE /products/:id/bundle-slots/:slotId/options[/:optionId]` | Slot option CRUD |

### Storefront

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/catalog/products/:idOrSlug/bundle-configuration/validate` | Pure compute: validate a buyer's bundle configuration |

The validation endpoint is the only POST on the public catalog surface.
It returns `{valid, errors[], resolvedSelections}` rather than
non-2xx — the storefront wants the structured error list so it can
highlight every offending slot.

## Validation errors (inside the response envelope)

| Code | When |
| --- | --- |
| `MIN_NOT_MET` | Total selected qty for a slot < `minQuantity` |
| `MAX_EXCEEDED` | Total selected qty for a slot > `maxQuantity` |
| `UNKNOWN_OPTION` | `optionId` not part of the slot |

HTTP-level rejections (400 `PRODUCT_TYPE_MISMATCH` when the product is
not a bundle, 404 `PRODUCT_NOT_FOUND`) still apply.

## CRUD-level errors

| Code | Status | When |
| --- | --- | --- |
| `PRODUCT_TYPE_MISMATCH` | 400 | Calling grouped/bundle endpoints against the wrong parent type |
| `NESTED_COMPOSITE_NOT_ALLOWED` | 400 | Child / option product is itself grouped or bundle |
| `INVALID_QUANTITY_RANGE` | 400 | Slot `minQuantity > maxQuantity` |
| `OPTION_ALREADY_EXISTS` | 409 | Same option product reused in a slot |
| `GROUPED_ITEM_NOT_FOUND` | 404 | `:itemId` missing |
| `BUNDLE_SLOT_NOT_FOUND` | 404 | `:slotId` missing |
| `BUNDLE_SLOT_OPTION_NOT_FOUND` | 404 | `:optionId` missing |

## Storefront integration

`productDetail` carries one of three branches based on `type`:

- `groupedItems[]` when type='grouped' — `{id, position, quantity, product{...}}`
- `bundleSlots[]` when type='bundle' — `{id, name, minQuantity, maxQuantity, position, options: [{id, defaultQuantity, position, product{...}}]}`
- `virtual` when type='virtual' — `{downloadAssetId, downloadUrl}`

The PDP type-switches the action zone:

| `product.type` | Component | UX |
| --- | --- | --- |
| `simple`, `configurable` | legacy Add-to-cart + RFQ + VariantPicker | unchanged |
| `grouped` | `<GroupedSummary>` | Read-only list + "Add bundle to cart" CTA |
| `bundle` | `<BundleConfigurator>` | Per-slot select + qty input; CTA disabled when any slot is required |
| `virtual` | `<VirtualCta>` | "Buy and download" CTA + delivery copy |

## Storage

- `grouped_items` (id, parent_product_id FK CASCADE, child_product_id
  FK RESTRICT, quantity, position; UNIQUE (parent, child); CHECK
  `quantity > 0` + `parent <> child`)
- `bundle_slots` (id, parent_product_id FK CASCADE, name jsonb,
  minQuantity / maxQuantity int; CHECK `min_quantity <= max_quantity` +
  `min_quantity >= 0` + `max_quantity > 0`)
- `bundle_slot_options` (id, slot_id FK CASCADE, option_product_id FK
  RESTRICT, default_quantity, position; UNIQUE (slot, option_product))

Virtual download fields live on the `products` table itself
(`download_asset_id` FK nullable + `download_url` varchar nullable),
introduced by US2 migration.
