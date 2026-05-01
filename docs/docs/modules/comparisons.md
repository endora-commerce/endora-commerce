---
title: comparisons
---

# `comparisons`

Customer-facing product-comparison module. Owns a first-class
`Comparison` resource (a customer-curated set of products with a chosen
display mode and a stable shareable link), an admin observability
surface, and the Node-side PDF export. The module deliberately holds no
catalog data; it consumes products and the `is_comparable` attribute
flag through the `CatalogQueryService` port (Constitution Principle I).

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/comparisons/me` | storefront (anonymous or customer) | Read the caller's Comparison; `204 No Content` when none |
| `POST /api/v1/comparisons/me/products` | storefront | Add a product (creates the Comparison + `compare_token` cookie on first call); refuses with `409 COMPARISON_FULL` over the channel-resolved cap |
| `DELETE /api/v1/comparisons/me/products/:productId` | storefront | Remove a product; `404 PRODUCT_NOT_IN_COMPARISON` if absent |
| `PATCH /api/v1/comparisons/me` | storefront | Update the persisted display mode (`all` / `common` / `differences`) |
| `DELETE /api/v1/comparisons/me` | storefront | Hard-delete the Comparison; the share token stops resolving for everyone |
| `GET /api/v1/comparisons/me/pdf` | storefront (owner only) | Owner PDF export; PDF mirrors the active mode and embeds product base images; `409 COMPARISON_EMPTY` for a zero-product comparison |
| `GET /api/v1/comparisons/share/:token` | public, no auth | Recipient view; same shape as the owner read minus `maxProducts`, plus `meta.viewerIsOwner`; `404 COMPARISON_NOT_FOUND` for a deleted/never-existed token |
| `GET /api/v1/admin/comparisons` | admin (`comparisons:read`) | List every Comparison with filters (channel, owner kind, time range) and cursor pagination |
| `GET /api/v1/admin/comparisons/:id` | admin (`comparisons:read`) | Read-only detail; rendered through the comparison's recorded sales channel so the view matches what the customer reported |

There is **no** comparisons-side cart proxy. The storefront's
*Add to cart* button on the comparison page calls the existing
`POST /api/v1/cart/items` directly (research.md R-9).

## Settings

One knob under the `compare` group, registered by
`backend/src/modules/comparisons/manifest.ts`:

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `compare.max_products` | `number` | `4` | Upper bound on a single Comparison; the store-front refuses to add the (max+1)-th product per channel. Sane range `1..16`. |

The bound is read at request time inside
`ComparisonService.addProduct(...)`. Lowering the cap mid-session does
**not** retroactively trim existing comparisons (research.md R-7); the
next add is the first request that picks up the new value.

## Catalog flag

The module relies on a new `is_comparable` boolean column on
`product_attributes`. Catalog owns the column (migration `028` lives
under `catalog/migrations/`); the comparisons module reads it through
`CatalogQueryService.comparableAttributeKeys()`.

The Catalog admin UI's `<AttributesManager>` exposes a `Comparable`
checkbox alongside `Searchable` and `Filterable`; toggling it has no
side effect (no event emission, no reindex) — the next comparison-page
render picks up the change directly from Postgres.

## Storage

Two tables, both owned by the comparisons module
(`027_comparisons_init.ts`):

- `comparisons` — primary key, 22-char base64url `share_token`
  (`UNIQUE`), exclusive owner column (`customer_account_id` *or*
  `anonymous_token`; DB CHECK enforces XOR), `sales_channel_id` (FK
  with `ON DELETE RESTRICT`), `display_mode`, `created_at`,
  `updated_at`. Partial indexes on each owner column; a separate index
  on `(sales_channel_id, created_at desc)` supports the admin overview
  channel filter.
- `comparison_products` — composite PK on
  `(comparison_id, product_id)`, `position` (smallint), `added_at`.
  Both FKs cascade. Reverse index on `product_id` for the admin list's
  product-count aggregate.

No soft-delete. Per spec FR-014, a deleted comparison must resolve to a
clear "no longer exists" state for shared-link recipients — a missing
row + `404 COMPARISON_NOT_FOUND` already satisfies that without a
soft-delete bit.

## Anonymous → authenticated identity

Anonymous customers carry the `compare_token` cookie (HttpOnly,
SameSite=Lax, Path=/, Max-Age = 1 year). At sign-in the existing
`onLogin` hook in `organizationsModule` extracts the cookie and calls
`ComparisonService.adoptAnonymousComparison(...)` (research.md R-2):

- Customer with no Comparison → the anonymous one is reassigned
  (`customer_account_id` set, `anonymous_token` cleared).
- Customer with an existing Comparison → the anonymous one is hard-
  deleted; the customer's curated set wins.

## PDF export

Generated server-side with `pdfmake` — the module's only new runtime
dependency, justified per Constitution IV in
`specs/007-compare-module/plan.md` Complexity Tracking. Document
definition is built declaratively from `ComparisonOwnerView`; product
base images are pre-fetched by `AssetByteFetcher` (per-request cache,
1×1 transparent PNG fallback) and embedded as data URIs. Page
orientation is landscape when product count ≥ 3, portrait otherwise.

A strict deny-all `setUrlAccessPolicy` pins the contract that pdfmake
never opens its own network sockets — every image reaches the document
through the AssetByteFetcher.

## Module isolation

| Direction | What we depend on | How |
| --- | --- | --- |
| Reads | Catalog products and `is_comparable` flag | `CatalogQueryService.comparableAttributeKeys()` + entity reads via the EM |
| Reads | `compare.max_products` | `SettingsService.get(...)` — same shape Search uses |
| Reads | Sales channel context (currency, public flag) | `request.salesChannel` from the resolver middleware |
| Reads | Customer email for the admin list | `CustomerAccount` entity — read-only join |
| Writes | None outside its own two tables | — |

The comparisons module has zero compile-time dependencies on the
`carts` module. Removing the comparisons module leaves catalog,
settings, sales_channels, and carts working — no dangling references.
