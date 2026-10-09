---
title: catalog
sidebar_label: Catalog
description: Products, variants, categories, attributes, sales channels
---

# `catalog`

The product catalog: Products, ProductVariants, Categories,
ProductAttributes, and SalesChannels. Owns all read paths the storefront
depends on and the admin-side authoring surface.

## Public surface

Admin routes are gated by `catalog:read` (list / get) /
`catalog:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/products` | storefront / API key | List/search/filter products in the active Sales Channel |
| `GET /api/v1/catalog/products/:idOrSlug` | storefront | Product detail (price omitted on non-public Sales Channels) |
| `GET /api/v1/catalog/categories` | storefront | Nested category tree |
| `GET /api/v1/catalog/categories/:id/content` | storefront | One category's page content, resolved to the caller's language |
| `GET /api/v1/catalog/filters` | storefront | Filterable attributes for the active Sales Channel |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | SEO sitemap |
| `GET /api/v1/admin/catalog/products?includeArchived` | admin | Admin product list (includes drafts; archived rows opt-in) |
| `GET /api/v1/admin/catalog/products/:id` | admin | Product detail |
| `POST /api/v1/admin/catalog/products` | admin | Create product (`type` immutable post-create; `sku` is editable) |
| `PATCH /api/v1/admin/catalog/products/:id` | admin | Update (incl. `sku`); writes an audit row with stateBefore / stateAfter; refuses with `409 sku_in_use` if the new SKU already belongs to another product |
| `DELETE /api/v1/admin/catalog/products/:id` | admin | Archive (soft) |
| `GET /api/v1/admin/catalog/attributes` | admin | List attributes |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | admin | Picker payload — every attribute carrying the requested flag |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | admin | Single attribute read |
| `POST /api/v1/admin/catalog/attributes` | admin | Create attribute (accepts the new flags + inline `options[]` for select-style types) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isPriceRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition` (re-emits `attribute.updated.v1`) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | admin | Delete; refused with `409 attribute_in_use_by_set` while any Attribute Set still references it |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | List option-list rows for select/enum/multiselect attributes |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Append an option |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | admin | Patch label / labelDefault / isDefault / sortOrder (option `value` is immutable) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | admin | Remove; refused with `409 option_in_use` while any product still carries the value |
| `POST /api/v1/admin/catalog/attribute-set-preview` | admin | Preview which Set's attributes will be edited / hidden when an operator switches a product's Attribute Set |
| `GET /api/v1/admin/catalog/categories` | admin | Flat list, the UI folds into a tree |
| `POST /api/v1/admin/catalog/categories` | admin | Create (parent must exist) |
| `PATCH /api/v1/admin/catalog/categories/:id` | admin | Update; reparenting walks the new parent's chain to refuse cycles (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | admin | Soft-delete; rejects with 409 if any active child still references the row |
| `GET /api/v1/admin/catalog/categories/:id/content` | admin | The category's page content — one Page Builder document per language ([Category page content](./catalog/category-content.md)) |
| `PUT /api/v1/admin/catalog/categories/:id/content` | admin | Replace the category's page content; `null` clears it |
| `PUT /api/v1/catalog/products/by-sku/:sku` | API key | Idempotent upsert (PIM sync) |

## Entities

`Product`, `ProductVariant`, `Category`, `ProductAttribute`,
`SalesChannel`, plus the M:N bridges
`product_categories`, `sales_channel_products`, `product_assets`.

## Events emitted

`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
`attribute.updated.v1`. Picked up by the search indexer. The three product
events are also offered to outbound webhooks (next section);
`attribute.updated.v1` is not.

`category.updated.v1` and `category.content.updated.v1` both flush the
storefront's category cache; the first also re-indexes the products of the
changed category's subtree.

## Events offered to outbound webhooks

The module contributes three event types to the `webhooks` module's
`webhookEventRegistry`, so a webhook subscription can name them while both
modules are present. The payload is sent whole; the strict schemas are
`CATALOG_WEBHOOK_EVENT_SCHEMAS` in `@endora-commerce/contracts`.

| Event | Sent when | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- |
| `product.created.v1` | A product is created — in the Admin UI, through the API-key upsert, by an import or a PIM synchronisation, or by duplicating another product. | `productId` (UUID), `sku` — the SKU it was created with; it can change later, `productId` cannot. |
| `product.updated.v1` | A product is written, or one of its variants is created, changed or deleted. | `productId`, `changedFields` — the names of the product fields the write addressed (`name`, `status`, `categoryIds`, …; `variants` for a variant write). Names only, an open list, and it may be empty. |
| `product.archived.v1` | A product's status moves to `inactive` from another status. Once per transition: editing a product that is already inactive does not send it again. | `productId` |

- **Order.** The archiving write sends `product.updated.v1` (with `status` in
  `changedFields`) and then `product.archived.v1`, on every path that can
  archive a product: the Admin UI, the API-key upsert, a bulk edit, an import.
- **Reactivation has no event of its own.** A product that leaves `inactive`
  sends `product.updated.v1` with `status` in `changedFields` and nothing else —
  the same signal as any other status change, a draft being published
  included. To tell them apart, read the product: its `status` is the answer.
- **Deletion is not delivered.** Deleting a product emits `product.deleted.v1`
  on the in-process event bus only; it is not offered to webhooks, and no
  `product.archived.v1` is sent for it. A receiver that mirrors the catalogue
  learns of a deletion by reading: the product is no longer returned by the
  API. Reconcile against a full listing if deletions matter to you.
- **After the commit.** Each event is sent for a write that was committed. A
  write that is refused or rolled back sends nothing.
- **No content leaves.** No name, description, price, attribute value or
  Organization allow-list is in any payload. A receiver reads the product
  through the API with its own key.
- **Platform-wide subscriptions only.** A product is not one Organization's
  data, so the payloads carry no `organizationId` and a subscription bound to
  an Organization never receives a product event.
- **Volume.** One event per product written. A bulk edit, an import or a PIM
  synchronisation writes products one by one and therefore sends one
  `product.updated.v1` per product; nothing is batched. With no subscription
  naming the type, nothing is enqueued.

## Extension points

- **Per-Sales-Channel pricing** — query service receives a SalesChannel
  context; new gating (e.g. customer-segment-specific catalogs) is added by
  composing into `catalog-query.service.ts`.
- **Slug uniqueness** — the slug is unique across all Sales Channels by
  default; override the slugifier in `catalog-admin.service.ts` if locale
  collisions become a concern.

## Product structure and composition surfaces

The catalog grew several capability surfaces, each with its own page:

- [Attribute Sets](./catalog/attribute-sets.md) — reusable attribute
  schemas pinned to Products, with a system Default
- [Product Gallery](./catalog/gallery-and-labels.md) — image / video
  gallery with Base / Small / Thumbnail label invariants enforced at
  the database level
- [Attachments](./catalog/attachments.md) — downloadable files
  (certificates, tech specs, ...) with a typed dictionary
- [Product Links](./catalog/product-links.md) — Related, Up-sell,
  Cross-sell pairings driving cross-merchandising on the PDP and cart
- [Composite Products](./catalog/composite-products.md) — `grouped`
  (fixed children), `bundle` (configurable slots), `virtual` (digital
  delivery)

Five product types are now supported: `simple`, `configurable`,
`grouped`, `bundle`, `virtual`. `simple` and `configurable` are the
original pair; the other three were added later.

## Attribute extensions on the Catalog read paths

The Attributes work added the operational surface the storefront
needs to render rich product information and the search / promotions
modules need to resolve customer queries. The dedicated
[Attributes](./catalog/attributes.md) page covers the attribute
authoring surface in full — this section only summarises what changed
on the Catalog read paths.

### New attribute flags

`ProductAttribute` gains four behavioural flags + a numeric position +
a per-locale label fallback:

- `isPromoRule` (boolean) — picker eligibility for the Promotion Rule
  editor's `attribute` criterion variant
- `isVisibleOnProductPage` (boolean) — surface the attribute on the
  storefront PDP "Parametry produktu" tab when the product carries a
  value
- `isRequired` (boolean) — enforced at product save time when the
  attribute is part of the product's Attribute Set
- `filterPosition` (number) — sort key for the storefront filter sidebar
  (lower comes first; ties broken by label)
- `labelDefault` (string) — fallback used when the active locale has no
  matching key in the per-locale `label` JSONB

### Option lists

Select-style attribute types (`select`, `enum`, `multiselect`) carry an
ordered option list — each row keyed by `(definition, value)` with
per-locale label + fallback + sort order + default flag. The legacy
`enum_values: string[]` JSONB column on `product_attributes` was
decommissioned by migration
`20260505T060113_catalog_attribute_options_and_flags.ts` (into the catalog-owned
`attribute_options` table), and migration
`20260723T230401_catalog_attributes_on_custom_fields.ts` moved the
rows into the generic `custom_field_options` table. Existing readers
project the option list back into the legacy form for backward
compatibility at the API boundary.

### Editable SKU

Product `sku` is mutable. The internal canonical reference for every
cross-module link (assets, links, RFQ items, ...) is the `Product.id`
UUID, which never changes. Updating the SKU writes an audit row and
refuses with `409 sku_in_use` if the new value already belongs to
another product.

### Attribute Set swap

When an operator assigns a different Attribute Set to a Product, the
admin form re-renders to show only the new Set's attributes. Values
for attributes outside the new Set stay in the JSONB column server-side
— switching back surfaces them again. The
`attribute-set-preview` endpoint lets the editor warn the operator
which fields will be hidden vs. retained before they confirm.

### Cross-module read surface

Two methods on `CatalogQueryService` cross module boundaries (the
documented service ports):

- `comparableAttributeKeys(): string[]` — Compare
- `promoRuleAttributeKeys(): string[]` + `getAttributeWithOptions(key)`
  — Promotions
- `buildVisibleAttributesProjection()` — internal, used by the PDP
  detail response to assemble the `visibleAttributes[]` payload

## Attributes as Custom Field extensions

The attribute definition store has converged onto the generic Custom
Fields layer that the `custom_fields` module owns, adapter-shaped rather
than rewritten. Nothing changed on the
HTTP surface — every endpoint above keeps its shape — but the storage
and ownership model is different:

- **A product attribute is a catalog extension of a product-host Custom
  Field definition.** The generic identity (`key`, per-locale `label` +
  `labelDefault`, `valueType`, `required`) lives on a
  `custom_field_definitions` row with `entity_type = 'product'`. The
  `product_attributes` table remains, rebuilt as a thin 1:1 extension
  row (`custom_field_definition_id` UNIQUE FK) carrying only the
  catalog behaviour flags (`isSearchable`, `isFilterable`,
  `isVariantAxis`, `displayAsSlider`, `isComparable`,
  `quickSearchable`, `isPromoRule`, `isPriceRule`, `filterPosition`,
  `isVisibleOnProductPage`, `channelScoped`, `languageScoped`,
  `massEditable`) plus two presentation refinements (`selectDisplay`,
  `numericKind`) that keep the legacy `enum`/`select` and
  `number`/`price` distinctions lossless. **Flags stay catalog-owned**
  — the generic core never interprets them.
- **Options live in `custom_field_options`.** The catalog-owned
  `attribute_options` table is gone; option lists are ordinary Custom
  Field option rows on the product-host definition.
- **Single write surface: `/catalog/attributes`.** Attribute and
  option mutations are catalog Commands that create/update/delete the
  definition and the extension together in one transaction (one audit
  row), using the transactional apply seam exported by
  `custom_fields`. The generic Custom Fields admin surface lists
  product definitions read-only and refuses mutations with
  `409 host_managed`.
- **Migration `20260723T230401_catalog_attributes_on_custom_fields.ts`** performed the
  one-time convergence in a single transaction: backfilled one
  definition per legacy attribute (key, labels, mapped value type,
  required, deterministic sort order), moved `attribute_options` rows
  into `custom_field_options`, re-keyed `attribute_set_attributes` to
  definition ids, added `custom_field_definition_id` /
  `select_display` / `numeric_kind` to `product_attributes`, dropped
  the duplicated columns (`key`, `label`, `label_default`,
  `value_type`, `is_required`), and dropped `attribute_options`. The
  migration is reversible (`down()` restores the legacy shape) and
  aborts loudly on a reserved-key collision.
- **Attribute values did not move** — `products.attribute_values`,
  `product_variants.variant_attribute_values`, and
  `product_value_overrides` keep their shape and catalog ownership
  (the host owns its data).

Internal consumers (search, quick order, comparisons, bulk edit, the
promotions port, the scope editor) read attributes through the
catalog-exported `CatalogAttributeReadService`, which composes the
definition and the extension into the legacy-shaped
`CatalogAttributeView`.
