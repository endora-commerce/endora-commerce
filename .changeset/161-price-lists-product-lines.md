---
'@endora-commerce/mod-price-lists': minor
---

The price-book lines read meets 150 ms p95 at 50 000 lines (feature 161, G15 redesign, `specs/161-price-book-editor/research.md` R14).

- **`price_list_product_lines`** (migration `20261022T182527_price_lists_product_lines`, entity `PriceListProductLine`): one row per product line of a book, backfilled from `price_list_matrix_entries` and kept equal to its `distinct price_list_id, product_id` by every write of this module in the same transaction (batch, base prices, duplicate, demo); both foreign keys cascade; a catalogue variant delete that leaves a line without rows is reconciled on `product.updated.v1`. `PriceBookService.reconcileProductLines(productId)` is new. Code that writes `price_list_matrix_entries` past the service must keep the table in step.
- **`GET /api/v1/admin/price-books/:id/lines`** — same shape; it now reads a visibility-only header, counts product lines from the new table, and pages and searches product lines through `catalogProductReadPort.pageProductsByAdminName` with the book's membership subquery (`priceBookMembership`), in the admin language (`en`, `pl`; others `en`). Attribute and category lines order by `foldAdminName` bytewise rather than `localeCompare`, so accented names sort with their base letter. `PriceBookReads` needs `pageProductsByAdminName` (was `pageProductIdsByName`) on its catalogue port.
