---
'@endora-commerce/mod-price-lists': minor
---

CSV export and import of a price book (feature 161, US9; FR-018, FR-038–FR-042), under *CSV file* in the book's price grid.

- **Export to CSV** (every reader): the book's rows for the grid's current filter, read 1 000 at a time, in the fixed price-book format — UTF-8 with a BOM, `;`, the header and kinds in the admin language, a decimal comma for a Polish administrator. The file is named `<book>-<date>-<en|pl>.csv`; more than 5 000 rows become numbered files of at most 5 000 rows each.
- **Import from CSV…** (only on a book the caller may change, and only while the grid holds no unsaved edits): a file of at most 5 MB and 5 000 rows. Either `;` or `,` works, as do a decimal comma or point, UTF-8 with or without a BOM, and Windows-1250, chosen by the administrator when the bytes are not UTF-8. Headers and kinds are read in English or Polish. Merge or replace. Local refusals and the server's `dryRun` refusals are listed with file line, column and reason, and the refused rows can be downloaded with a `reason` column. The preview lists changed (old → new), added and, in replace mode, removed rows. Nothing is written until *Import*, which is offered only for a preview with changes and no refused row; it sends the same batch once against the preview's version, and a book saved since is refused with a new preview offered.
- New pure codec `src/admin/lib/price-book-csv.ts`; `readDecimalText` exported from `src/admin/lib/price-cell.ts`. Strings under `grid.csv.*` and `import.*`, English and Polish.
