---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': patch
---

The four price-matrix error codes are gone (feature 160): `ERROR_CODES.PRICE_MATRIX_ENTRY_NOT_FOUND`, `PRICE_MATRIX_ENTRY_OVERLAP`, `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE` and `PRICE_MATRIX_ENTRY_LIMIT` are no longer exported or declared by `price_lists`, and their sentences and the unused `priceMatrix.*` admin strings are removed from both bundles. Nothing has raised them since the matrix entries became price-book rows: a row is refused with `PRICE_BOOK_ROW_SHAPE`, `PRICE_BOOK_ROW_OVERLAP`, `PRICE_BOOK_ROW_TARGET` or `PRICE_BOOK_ROW_LIMIT`.
