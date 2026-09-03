---
title: Product Gallery
---

# Product Gallery

Each Product can carry a curated gallery of image and video Assets, with
three labels that pin the storefront's resolution chain:

- **Base Image** — the primary hero shown on the PDP. Exactly one per Product.
- **Small Image** — emphasized in the thumbnail strip. Exactly one per Product.
- **Thumbnail** — the listing-card image. Exactly one per Product.

Each Gallery Item can carry **one to three** of these labels (the same
asset can be both Base Image and Thumbnail, for example). The "exactly
one per Product per label" invariant is enforced by a database
`UNIQUE (product_id, label)` constraint, so collisions surface as a
typed conflict error rather than silent data corruption.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/gallery` | admin | List the Product's gallery |
| `POST /api/v1/admin/catalog/products/:id/gallery` | admin | Attach an existing image/video Asset with optional labels |
| `POST .../gallery?replace=true` | admin | Atomic-swap: remove conflicting labels from other items in this Product, then assign |
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Update labels (same `?replace=true` toggle) |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Remove from gallery (Asset row survives) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | admin | Reorder by id list |

## Atomic label swap

Without the `?replace=true` query, assigning a label that already exists
on another item returns `409 GALLERY_LABEL_ALREADY_TAKEN`. With it, the
service drops the conflicting assignments first then inserts the new
one — all in a single transaction, so concurrent admins never see a
half-applied state.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Label conflict without `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | More than 3 labels on a single item |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Asset kind ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | `:itemId` missing |
| `PRODUCT_NOT_FOUND` | 404 | `:id` missing |

## Storefront integration

`productDetail.gallery[]` carries `{id, position, labels[], asset{id, kind, url}}`.
The `<GallerySwitcher>` component renders the Base Image as the primary
`<img>` (or the first item if no Base Image is set) and emits a thumbnail
strip with the Small Image marked via `data-small-image="true"` for
themes to highlight.

## Listing card thumbnail resolution

`ProductSummary.primaryAssetUrl` (used by the listing card) is resolved
server-side via the chain: Thumbnail → Base Image → first gallery item
→ legacy `product_assets` row → null.

## OG image resolution

`productDetail.seo.openGraph.imageUrl` prefers the gallery's Base Image
over the listing thumbnail so social shares get the marketer's hero shot.

## Storage

`gallery_items` (id, product_id FK CASCADE, asset_id FK RESTRICT,
position, timestamps) + `gallery_item_labels` (composite PK on
(gallery_item_id, label), `UNIQUE (product_id, label)`, CHECK label IN
('base_image', 'small_image', 'thumbnail')).
