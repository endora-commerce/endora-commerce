---
'@endora-commerce/mod-price-lists': minor
---

The admin price-book API gains what the editor needs (feature 161, G11, G12, G15, G16, G18).

- **`writable` (G11)** on `GET /api/v1/admin/price-books/:id`, on every line of `GET /api/v1/admin/price-books` and on `GET …/base-prices?productId=`, and `meta.creatableAudienceKinds` on the list — the server's scope rule, so the browser never re-derives it. `PriceBookService.basePrices(productId, scope?)` takes the caller's scope (default: every book).
- **`GET …/targets/organizations?ids=a,b` (G12)** labels stored organization members (≤ 1 000 ids), scope-filtered like the search: an out-of-scope or unknown id is absent, never an error. `ids` with `search` is `400`.
- **`GET /api/v1/admin/price-books/:id/lines` (G15)** — the book paged by whole line (a selection with every row, a product with its variant lines), general to specific and by label; `kind` and `search` filters; `meta.totalLines`. Product lines are ordered and searched by `catalogProductReadPort.pageProductsByAdminName` (see the product-lines note).
- **Named runner-ups (G16)** — `POST …/resolve` candidates carry `bookName` and `labels`; `BookExplanation.candidates[]` carries `bookName`.
- **Batch validation scoped to the batch (G18)** — `PUT …/:id/rows` (and its dry run) reads the stored rows of the selections and ids the batch names and the book's row count, not the whole book; replace mode still reads every row. The 5 000-row cap (`PRICE_BOOK_MAX_ROWS`) applies to non-base books only: a base book accepts batches past 5 000 rows (owner ruling, 2026-10-22). The per-batch cap is unchanged. `planBatch` takes `storedRowCount`; `touchedSelections` is new.
- **Decimal helpers (G17)** — `matrix-decimal.ts` re-exports the eight price-book helpers from `@endora-commerce/contracts` instead of defining them.
