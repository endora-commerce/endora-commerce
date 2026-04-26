---
title: quick_order
---

# `quick_order`

Bulk-add helper for buyers who already know SKUs. Two thin endpoints on
top of the catalog: a CSV import that returns recognised + rejected rows
with line numbers preserved, and a type-ahead search keyed to the
catalog's SKU + slug.

## Public surface

Both endpoints require an authenticated customer session — SKU-to-product
disclosure is gated to logged-in buyers per FR-009.

| Verb + Path | Purpose |
| --- | --- |
| `POST /api/v1/quick-order/import` | Parse a CSV blob with `sku,quantity` headers; partition into recognised + rejected rows |
| `GET /api/v1/quick-order/search?q&limit` | ILIKE prefix match on SKU + slug for the type-ahead row-by-row builder |

## CSV import semantics

`QuickOrderCsvImporter` is lenient on input formatting and strict on data:

- whitespace + double-quoted fields are stripped
- column headers can appear in any order; both `sku` and `quantity`
  are required
- blank lines + trailing whitespace are skipped silently

Each rejected row carries one of:

- `sku_missing`
- `quantity_invalid` (non-positive or non-integer)
- `product_not_found`
- `product_archived`
- `malformed_row` (header missing or row too short)

Rows are matched against `Product.sku` directly; variant resolution is a
follow-up that would extend the response with a `variantId` field.

## Storefront UX

The storefront's `/quick-order` page walks the buyer through:

1. paste CSV → server-action POSTs `/quick-order/import` →
2. server-renders the partition (the preview blob is base64 in the URL,
   not in client state) → buyer reviews →
3. "Add all to cart" loops every recognised row through
   `POST /api/v1/cart/items`.

## Extension points

- **Variant resolution** — adding a third column (e.g. `variant_sku`) is
  a one-method change in the importer; the response shape already has
  a nullable `variantId`.
- **Per-customer pricing preview** — the importer doesn't compute
  prices today; chaining the existing `PriceListService.priceFor` would
  let the preview show the cart total before commit.
- **Meilisearch-backed search** — the type-ahead currently does a
  Postgres ILIKE on `sku` + `slug`; switch to the Meilisearch index for
  full-text matching across the multilingual `name` JSONB.
