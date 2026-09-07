---
title: Product Links
---

# Product Links

Directed links between Products that drive cross-merchandising on the
PDP and cart. Three kinds:

- **Related** — "Related products" section on the PDP
- **Up-sell** — "You might also like" on the PDP
- **Cross-sell** — "You may also need" on the cart page

## DB-level guarantees

Migration 022 ships three constraints that make incorrect link data
impossible:

- `UNIQUE (source_product_id, target_product_id, kind)` — same pair can
  appear once per kind, never twice for the same kind
- `CHECK source_product_id <> target_product_id` — defence-in-depth
  against self-links beyond the API-layer guard
- `CHECK kind IN ('related','up_sell','cross_sell')`

Both FK columns cascade on product delete: link rows have no value when
either side is gone.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/links?kind=...` | admin | List links optionally filtered by kind |
| `POST /api/v1/admin/catalog/products/:id/links` | admin | Bulk create — all-or-nothing transaction |
| `DELETE /api/v1/admin/catalog/products/:id/links/:linkId` | admin | Remove a single link |
| `PUT /api/v1/admin/catalog/products/:id/links/:kind/order` | admin | Reorder by id list |
| `GET /api/v1/catalog/products/:idOrSlug/links?kind=...` | storefront | Storefront read; archived/channel-restricted targets filtered server-side |

## Bulk create semantics

`POST .../links` accepts a `links[]` array where each entry has
`{targetProductId, kind, position?}`. The service validates the whole
batch before inserting any row:

1. Source product exists and is not archived (404 otherwise)
2. No entry has `targetProductId === sourceProductId` (400)
3. All targets exist (404 with the offending id)
4. No `(source, target, kind)` already exists (409)

If any check fails, **no rows are inserted**. This matches the admin UX
of submitting a curated batch — partial inserts would surprise an
admin who's still finishing their picks.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `SELF_LINK_NOT_ALLOWED` | 400 | source = target |
| `LINK_ALREADY_EXISTS` | 409 | Duplicate `(source, target, kind)` |
| `TARGET_PRODUCT_NOT_FOUND` | 404 | Any target id missing |
| `PRODUCT_LINK_NOT_FOUND` | 404 | `:linkId` missing |

## Storefront integration

`productDetail.links` carries pre-grouped arrays sliced to default page
sizes (research §US4 + spec.md US4 Assumptions): `related[8]`,
`upSell[4]`, `crossSell[4]`. Each entry is a storefront-shape link
summary `{id, kind, position, product{id, sku, slug, name,
primaryAssetUrl, price}}` so the listing card renders without a
follow-up fetch.

The `<ProductLinksSections>` PDP component renders Related and Up-sell
under their own headings. The `<CrossSellSection>` cart component
fetches cross-sell links per cart item and dedupes by product id so the
same target shows up once even when reached via multiple cart entries.

## Storage

Single `product_links` table with the constraints above plus indexes on
`(source_product_id, kind)` and `(target_product_id)`.
