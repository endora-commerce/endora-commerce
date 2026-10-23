---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': minor
---

Which picked products already have a line in a price book, in one request (feature 161, Checkpoint 5 review).

- **`GET /api/v1/admin/price-books/:id/product-lines?productIds=a,b`** (`price_lists:read`, the book's visibility): answers `{ data: { productIds } }`, the named products with a line in the book (a row of the product or of one of its variants), read from `price_list_product_lines`. At most 200 ids (`PRICE_BOOK_PRODUCT_LINES_MAX_IDS`); none, a non-uuid or more is `400`; an out-of-scope book `404`. `PriceBookReads.productLines(bookId, productIds, scope)` is new.
- **Contracts:** `priceBookProductLinesQuerySchema`, `priceBookProductLinesResponseSchema` and their types.
- **The grid** asks it before adding products from the browser: a product already in the book is not added again (its stored price is never overwritten) and is offered to be opened where it is.
