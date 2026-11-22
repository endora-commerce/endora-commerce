---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-catalog': patch
---

The admin products list now uses the kit `ListPage` (issue #1749), the last catalog list to move. The status tabs sit under the header, the toolbar is a plain row with the matching-product count at its end, and the bulk bar, the table and the pager share one results card. The first load shows the kit skeleton; a page turn, a filter change or a refresh after a bulk action keeps the rows on screen, so the focused control keeps its focus. A load failure shows the kit error with **Retry**. Each product's name is now a link to its editor, so the keyboard can open a product; the row is no longer a click target of its own. Saved views, bulk edit, *select all matching*, every filter (stock included, and its absence while inventory is off) and the empty states work as before.

- `@endora-commerce/admin-kit`: `ResponsiveTable` takes `isRowSelected`, which marks selected rows and cards with `data-state="selected"` (drawn in the selected tint).
- `@endora-commerce/mod-catalog`: new `en` / `pl` key `productsList.count`; the unused `productsList.loading` is removed.
