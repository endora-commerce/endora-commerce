---
title: Product gallery
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
| `PATCH /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Update labels (same `?replace=true` toggle), alt text per language, channels the item is hidden in |
| `GET /api/v1/admin/catalog/products/:id/gallery/channel-roles` | admin | Each sales channel's own role holders |
| `PUT /api/v1/admin/catalog/products/:id/gallery/channel-roles` | admin | Set or clear a sales channel's own role holders |
| `DELETE /api/v1/admin/catalog/products/:id/gallery/:itemId` | admin | Remove from gallery (Asset row survives) |
| `PUT /api/v1/admin/catalog/products/:id/gallery/order` | admin | Reorder by id list |

## Atomic label swap

Without the `?replace=true` query, assigning a label that already exists
on another item returns `409 GALLERY_LABEL_ALREADY_TAKEN`. With it, the
service drops the conflicting assignments first then inserts the new
one — all in a single transaction, so concurrent admins never see a
half-applied state.

## Per sales channel and per language

The set of images is the same in every sales channel: a channel cannot add an image
of its own or reorder the gallery. What a channel can change is which image holds
each role and which images it shows. The alt text can be set per language.

- **Role per channel.** `PUT …/gallery/channel-roles` with
  `{ "channelId": "…", "roles": { "baseImage": "<itemId>", "smallImage": null } }`
  gives the channel its own holder of a role. `null` returns the role to the global
  holder; a role left out is unchanged. The keys are `baseImage`, `smallImage` and
  `thumbnail`. Each role has at most one holder per channel. `GET` lists the
  channels that have an override of their own.
- **Hidden per channel.** `PATCH …/gallery/:itemId` with
  `{ "hiddenInChannels": ["…"] }` replaces the set of channels the image is hidden
  in. A hidden image is not served in that channel: not in the product page's
  gallery, not as the listing card's image, not as the Open Graph image, not in a
  product feed of that channel and not in a comparison seen in it. A role whose
  holder is hidden in a channel has no holder there, so the listing card moves on to
  the next image in its chain.
- **Alt text per language.** `PATCH …/gallery/:itemId` with
  `{ "altText": { "pl-PL": "…", "de-DE": "" } }` sets the product's own alt text of
  the image in each named language. An empty string removes that language, and a
  language left out is unchanged. The product page serves the text in the request's
  language, else the asset's own alt text.

You can hide an image or give it a role only in a channel the product is in;
otherwise the request answers `422 SCOPE_INVALID`. Removing an override is always
allowed, even after the product has left the channel.

Hiding is presentation, not access control. A hidden image is not shown in the
channel, but its file keeps its stable URL, and anyone who has that URL can still
fetch it. Do not rely on hiding to keep an image confidential: a file that must
not be public must not be in the product's gallery.

Each of these writes is recorded once in the audit log as
`product.media.update`, with the item's (or the channel's roles') state before and
after. Sending the recorded before-state back through the same route restores it.
The write announces `product.updated.v1` with `changedFields: ["media"]`. A request
that changes nothing writes nothing and announces nothing.

The same holds for an item's labels and for the gallery's order. A `PATCH` that
changes labels records them (`labels`) in the item's state; the labels are
replaced in the same transaction as the rest of the item, so a refused label leaves
the item untouched. With `?replace=true` the entry restores this item only: a label
taken from another item is not handed back by re-sending it. `PUT …/gallery/order`
records `orderedGalleryItemIds` before and after, and runs in one transaction.
Deleting an item is recorded once, as `gallery_item.delete`.

With no override, every channel shows the global gallery, as before.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `GALLERY_LABEL_ALREADY_TAKEN` | 409 | Label conflict without `?replace=true` |
| `GALLERY_LABEL_LIMIT_EXCEEDED` | 400 | More than 3 labels on a single item |
| `ASSET_KIND_NOT_SUPPORTED` | 400 | Asset kind ∉ `{image, video}` |
| `GALLERY_ITEM_NOT_FOUND` | 404 | `:itemId` missing, or a channel role names an item of another product |
| `SCOPE_INVALID` | 422 | Hiding an image or giving a role in a channel the product is not in |
| `PRODUCT_NOT_FOUND` | 404 | `:id` missing |

## Storefront integration

`productDetail.gallery[]` carries `{id, position, labels[], asset{id, kind, url}, altText}`,
as the request's sales channel shows it: hidden items are left out, `labels` are the
channel's roles, and `altText` is in the request's language.
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
('base_image', 'small_image', 'thumbnail')). `gallery_items.alt_text` holds the alt
text per language. `gallery_item_channel_labels` holds a channel's own role holder
(primary key (product_id, sales_channel_id, label)) and `gallery_item_channel_hidden`
an item hidden in a channel (primary key (gallery_item_id, sales_channel_id)); both
cascade on the product's, the item's and the channel's delete.
