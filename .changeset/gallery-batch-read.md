---
'@endora-commerce/contracts': minor
---

`CatalogGalleryPort` gains two batch reads, and `CatalogGalleryBatchItem` is
exported beside it.

`listForProducts(productIds)` answers the gallery of a **batch** of products —
`{ productId, assetId, position }` per item, ordered by product and then by the
operator's position — in one statement. `list(productId)` remains for the single
product; it verifies the product exists and runs two further queries, so a page
of 500 products costs 1500 round-trips through it against one here. It carries
no labels and no timestamps deliberately: the callers that walk a page read
neither, and fetching them costs a second statement per batch.

`baseImageUrls(productIds)` answers `Map<string, string | null>` — the
`base_image` url of each product, with **no** fallback to `thumbnail` or to the
first gallery item. The map holds one entry per requested id, so a caller can
index it without re-checking membership.

Both treat an id that resolves to nothing as **data**: no row comes back and
nothing throws, because a caller holding an id whose product has since been
removed is asking about the batch it has. `baseImageUrls` therefore answers
`null` for all three of "no `base_image` label", "no such product" and "the
asset row behind the label is gone"; the three are not distinguished, as a
caller that renders a placeholder reads one branch either way.

Additive for a **caller** — an existing `list` / `create` / `delete` / `reorder`
call is unchanged. An **implementer** of `CatalogGalleryPort` (a test double, an
alternative provider) must add the two methods: D-97.3 forbids optional methods
on a published port, since `lazyPort`'s proxy answers every property with a
function and feature detection through it is impossible by construction.
