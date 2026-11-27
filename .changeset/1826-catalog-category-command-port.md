---
'@endora-commerce/mod-catalog': minor
---

`catalog` registers `catalogCategoryCommandPort`, the Category aggregate's write port (issue #1826, `specs/186-aggregate-ports/` US8). Its methods run the Commands the admin category routes run, from one set of factories, so a port call writes the same audit entry and emits the same `category.updated.v1` (search re-index, storefront navigation refresh) as the admin edit. A worker calls it under `withSystemScope`, naming itself with `options.source`, which is recorded in the entry.

`catalogCategoryWritePort` is deprecated and delegates. A category's inventory thresholds are now the audited Command `category.inventory_thresholds.set` (object type `category`, the three columns before and after; a patch that changes nothing records nothing), from either port. See *Writing categories from server code* in the Catalog documentation.
