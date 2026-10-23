---
'@endora-commerce/admin-kit': minor
---

`PaginationFooter` takes an optional `pageSizes` (feature 161): the page sizes its rows-per-page select offers, for a list whose API pages differently. Omitted, it offers `PAGE_SIZE_OPTIONS` as before. The props are generic over the size type — `PaginationFooterProps<S extends number = PageSizeOption>` — so `pageSize` and `onPageSizeChange` take the caller's sizes; existing callers are unchanged.
