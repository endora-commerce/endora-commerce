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
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Move the item (`position`) |
| `PUT /api/v1/admin/catalog/products/:id/scoped-values` | admin | Alt text, hidden flag and role holders at Global, a channel, or a channel and language (see below) |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Remove from gallery (Asset row survives) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | admin | Reorder by id list |

## Atomic label swap

Without the `?replace=true` query, assigning a label that already exists
on another item when adding it returns `409 GALLERY_LABEL_ALREADY_TAKEN`. With it, the
service drops the conflicting assignments first then inserts the new
one — all in a single transaction, so concurrent admins never see a
half-applied state.

## Per scope: Global, Channel, Channel × language

The set of images is the same in every sales channel: a channel cannot add an image
of its own or reorder the gallery. What a scope can change is the image's alt text,
whether the image is shown, and which image holds each role. All three are scoped
fields, saved with the rest of the scope by `PUT …/products/:id/scoped-values`:

```json
{
  "scope": { "channelId": "<retail-uuid>", "languageCode": "pl-PL" },
  "version": "7",
  "changes": {
    "gallery": {
      "items": { "<itemId>": { "altText": "Wiertarka z boku", "hidden": { "inherit": true } } },
      "roles": { "baseImage": "<itemId>", "smallImage": null }
    }
  }
}
```

- **Alt text** — at Global, a channel, or a channel and language. With no product alt
  text anywhere up the chain, the asset's own alt text in the request's language
  applies. A deliberately empty alt text (`null`) renders as `alt=""`: the image is
  decorative there, and the asset's alt text is not used.
- **Hidden** — at Global, a channel, or a channel and language; `true` or `false`, never
  empty. A hidden image is not served at that scope: not in the product page's gallery,
  not as the listing card's image, not as the Open Graph image, not in a product feed
  and not in a comparison.
- **Role holders** (`baseImage`, `smallImage`, `thumbnail`) — at Global, a channel, or a
  channel and language. `null` stores an empty override: no image holds the role there.
  `{ "inherit": true }` returns the role to the parent scope. A role whose holder is
  hidden at the scope has no holder there, so the listing card moves on to the next
  image in its chain. Removing the holding image makes an override inherit again.

A scope that does not write a field inherits it from the parent scope —
Channel × language → Channel → Global. Writing at a channel the product is not in,
or a language the channel does not offer, answers `422 SCOPE_INVALID`. Removing an
override is always allowed, even after the product has left the channel.

Hiding is presentation, not access control. A hidden image is not shown at the
scope, but its file keeps its stable URL, and anyone who has that URL can still
fetch it. Do not rely on hiding to keep an image confidential: a file that must
not be public must not be in the product's gallery.

A save is one audited Command, `product.scoped_values.save`, and announces
`product.updated.v1`. `PUT …/gallery/order` records `orderedGalleryItemIds` before and
after, and runs in one transaction. Deleting an item is recorded once, as
`gallery_item.delete`, and removes its overrides at every scope.

With no override, every channel and language shows the Global gallery.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Label conflict without `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | More than 3 labels on a single item |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Asset kind ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | `:itemId` missing |
| `SCOPE_INVALID` | 422 | A scoped gallery value for a channel the product is not in, or a language the channel does not offer |
| `PRODUCT_NOT_FOUND` | 404 | `:id` missing |

## Storefront integration

`productDetail.gallery[]` carries `{id, position, labels[], asset{id, kind, url}, altText}`,
as the request's sales channel and language show it: hidden items are left out, `labels`
are the effective roles there, and `altText` is the effective alt text there.
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

`gallery_items` (id, product_id FK CASCADE, asset_id FK RESTRICT, position, the Global
`alt_text` and `hidden`, timestamps) + `gallery_item_labels` (composite PK on
(gallery_item_id, label), `UNIQUE (product_id, label)`, CHECK label IN
('base_image', 'small_image', 'thumbnail')) — the Global role holders.
`gallery_item_scope_overrides` holds an item's alt text and hidden flag at a channel
or a channel and language, and `gallery_role_scope_overrides` a role's holder there
(`gallery_item_id` `null` = no image holds it). Both reference the item together with
its product, so an override cannot point at another product's image, and both cascade
on the product's, the item's and the channel's delete.
