---
title: catalog
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
| `GET /api/v1/catalog/filters` | storefront | Filterable attributes for the active Sales Channel |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | SEO sitemap |
| `GET /api/v1/admin/catalog/products?includeArchived` | admin | Admin product list (includes drafts; archived rows opt-in) |
| `GET /api/v1/admin/catalog/products/:id` | admin | Product detail |
| `POST /api/v1/admin/catalog/products` | admin | Create product (`type` immutable post-create; `sku` is editable per feature 012 / US3) |
| `PATCH /api/v1/admin/catalog/products/:id` | admin | Update (incl. `sku`); writes an audit row with stateBefore / stateAfter; refuses with `409 sku_in_use` if the new SKU already belongs to another product |
| `DELETE /api/v1/admin/catalog/products/:id` | admin | Archive (soft) |
| `GET /api/v1/admin/catalog/attributes` | admin | List attributes |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | admin | Picker payload — every attribute carrying the requested flag (feature 012 / US1) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | admin | Single attribute read |
| `POST /api/v1/admin/catalog/attributes` | admin | Create attribute (accepts the new flags + inline `options[]` for select-style types) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition` (re-emits `attribute.updated.v1`) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | admin | Delete; refused with `409 attribute_in_use_by_set` while any Attribute Set still references it (feature 012 / US1) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | List option-list rows for select/enum/multiselect attributes (feature 012 / US4) |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Append an option |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | admin | Patch label / labelDefault / isDefault / sortOrder (option `value` is immutable per FR-026) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | admin | Remove; refused with `409 option_in_use` while any product still carries the value (FR-025) |
| `POST /api/v1/admin/catalog/attribute-set-preview` | admin | Preview which Set's attributes will be edited / hidden when an operator switches a product's Attribute Set (feature 012 / US2) |
| `GET /api/v1/admin/catalog/categories` | admin | Flat list, the UI folds into a tree |
| `POST /api/v1/admin/catalog/categories` | admin | Create (parent must exist) |
| `PATCH /api/v1/admin/catalog/categories/:id` | admin | Update; reparenting walks the new parent's chain to refuse cycles (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | admin | Soft-delete; rejects with 409 if any active child still references the row |
| `PUT /api/v1/catalog/products/by-sku/:sku` | API key | Idempotent upsert (PIM sync) |

## Entities

`Product`, `ProductVariant`, `Category`, `ProductAttribute`,
`SalesChannel`, plus the M:N bridges
`product_categories`, `sales_channel_products`, `product_assets`. The
authoritative ER diagram is in `specs/001-b2b-platform-foundation/data-model.md`
in the source repository.

## Events emitted

`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
`attribute.updated.v1`. Picked up by the search indexer and bridged to
webhook subscribers.

## Extension points

- **Per-Sales-Channel pricing** — query service receives a SalesChannel
  context; new gating (e.g. customer-segment-specific catalogs) is added by
  composing into `catalog-query.service.ts`.
- **Slug uniqueness** — the slug is unique across all Sales Channels by
  default; override the slugifier in `catalog-admin.service.ts` if locale
  collisions become a concern.

## Feature 002 extensions

The catalog grew several capability surfaces in feature 002. Each has its
own page:

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
foundation 001 originals; the other three are added in 002.

## Feature 012 extensions

Feature 012 (Attributes) added the operational surface the storefront
needs to render rich product information and the search / promotions
modules need to resolve customer queries.

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

### Option lists (US4)

Select-style attribute types (`select`, `enum`, `multiselect`) carry an
`AttributeOption[]` table — each row keyed by `(attributeId, value)`
with per-locale label + fallback + sort order + default flag. The
legacy `enum_values: string[]` JSONB column on `product_attributes` was
decommissioned by migration 032. Existing readers project the new shape
back into the legacy form for backward compatibility at the API
boundary.

### Editable SKU (US3)

Product `sku` is mutable. The internal canonical reference for every
cross-module link (assets, links, RFQ items, ...) is the `Product.id`
UUID, which never changes. Updating the SKU writes an audit row and
refuses with `409 sku_in_use` if the new value already belongs to
another product.

### Attribute Set swap (US2)

When an operator assigns a different Attribute Set to a Product, the
admin form re-renders to show only the new Set's attributes. Values
for attributes outside the new Set stay in the JSONB column server-side
(FR-012) — switching back surfaces them again. The
`attribute-set-preview` endpoint lets the editor warn the operator
which fields will be hidden vs. retained before they confirm.

### Cross-module read surface

Two methods on `CatalogQueryService` cross module boundaries (the
documented service ports per Constitution I):

- `comparableAttributeKeys(): string[]` — feature 007 (Compare)
- `promoRuleAttributeKeys(): string[]` + `getAttributeWithOptions(key)`
  — feature 012 / US8 (Promotions)
- `buildVisibleAttributesProjection()` — internal, used by the PDP
  detail response to assemble the `visibleAttributes[]` payload
