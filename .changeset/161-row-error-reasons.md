---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': minor
---

A refused price-book row names the rule it broke (feature 161, Checkpoint 11 ruling 2; `specs/conventions/module-i18n.md`: the backend returns codes, the consumer translates them).

- **Contracts:** `priceBookRowErrorSchema` gains an optional `reason`, one of the new `PRICE_BOOK_ROW_ERROR_REASONS` (`priceBookRowErrorReasonSchema`, `PriceBookRowErrorReason`). The values are:
  - `row_invalid`, `selection_combined`, `max_below_min`, `fixed_on_all`, `variant_needs_product`, `base_book_kind`, `base_product_fixed`;
  - `product_unknown`, `variant_unknown`, `variant_other_product`, `category_unknown`;
  - `attribute_not_selectable`, `attribute_value_unknown`, `attribute_value_boolean`;
  - `row_not_in_book`, `rows_overlap`, `book_row_limit`.

  `priceBookRowShapeIssues` returns each issue's `reason`. The change is additive: `code`, `field` and `message` are unchanged.
- **`PUT /api/v1/admin/price-books/:id/rows`** (and its `?dryRun=true` preview) sets `reason` on every row error. Old: the attribute refusal was one `PRICE_BOOK_ROW_TARGET` whose English message told the cases apart. New: three reasons. An unknown variant id is now `variant_unknown`; a variant of another product is `variant_other_product`.
- **Admin:** the grid's cell reasons (`errors.reason.*`) and the CSV preview's refusals (`import.reason.*`) translate the rule in English and Polish; the preview no longer quotes the server's English. The display-mode override row's help line and its two errors are in the module's bundle (Checkpoint 11 ruling 3). The import preview notes when refused lines were not compared.
