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
| `POST /api/v1/admin/catalog/products` | admin | Create product (sku + type immutable post-create) |
| `PATCH /api/v1/admin/catalog/products/:id` | admin | Update; writes an audit row with stateBefore / stateAfter |
| `DELETE /api/v1/admin/catalog/products/:id` | admin | Archive (soft) |
| `GET /api/v1/admin/catalog/attributes` | admin | List attributes |
| `POST /api/v1/admin/catalog/attributes` | admin | Create attribute |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` (re-emits `attribute.updated.v1`) |
| `GET /api/v1/admin/catalog/categories` | admin | Flat list, the UI folds into a tree |
| `POST /api/v1/admin/catalog/categories` | admin | Create (parent must exist) |
| `PATCH /api/v1/admin/catalog/categories/:id` | admin | Update; reparenting walks the new parent's chain to refuse cycles (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | admin | Soft-delete; rejects with 409 if any active child still references the row |
| `PUT /api/v1/catalog/products/by-sku/:sku` | API key | Idempotent upsert (PIM sync) |

## Entities

`Product`, `ProductVariant`, `Category`, `ProductAttribute`,
`SalesChannel`, plus the M:N bridges
`product_categories`, `sales_channel_products`, `product_assets`. See
[data-model.md](../../../specs/001-b2b-platform-foundation/data-model.md).

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
