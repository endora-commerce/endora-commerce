# Contract — The price-book CSV format (FR-018, FR-038–FR-042)

One fixed format for export and import, so an exported file re-imports unchanged (SC-009). Codec:
`packages/modules/price_lists/src/admin/lib/price-book-csv.ts` (pure, no dependency).

## File

- **Encoding**: export writes UTF-8 with a BOM. Import reads UTF-8 (with or without BOM); when strict
  UTF-8 decoding fails it decodes as Windows-1250 and asks the administrator to confirm or switch
  (FR-039).
- **Separator**: export writes `;`. Import accepts `;` or `,`, sniffed from the header line; a quoted
  field may contain either and `""` escapes a quote (RFC 4180 quoting).
- **Decimal separator**: export writes a decimal comma when the admin language is Polish and a point
  otherwise; the file name says which (`<book>-<YYYY-MM-DD>-pl.csv` / `-en.csv`). Import accepts either
  in every numeric column; a grouping space (`1 234,50`) and a currency symbol are dropped; a value
  containing both `,` and `.` is read with the last one as the decimal separator.
- **Limits**: a file over 5 MB is refused before reading; more than 5 000 data lines are refused before
  any request (`PRICE_BOOK_MAX_ROWS`).
- **Several files**: an export of more than 5 000 rows is written as numbered files of at most 5 000
  rows, each a complete file with its header: `<book>-<YYYY-MM-DD>-<language>-<i>-of-<n>.csv`
  (implemented 2026-10-23, T092).

## Columns (header row required, in this order)

| # | English header | Polish header | Value |
| --- | --- | --- | --- |
| 1 | `kind` | `rodzaj` | `all`, `attribute`, `category`, `category_attribute`, `product`, `variant` (Polish aliases: `wszystkie`, `atrybut`, `kategoria`, `kategoria_atrybut`, `produkt`, `wariant`) |
| 2 | `product_sku` | `sku_produktu` | product SKU (`product`, `variant`) |
| 3 | `variant_sku` | `sku_wariantu` | variant SKU (`variant`) |
| 4 | `category_path` | `sciezka_kategorii` | category slugs from the root joined by `/` (`category`, `category_attribute`) |
| 5 | `attribute_key` | `kod_atrybutu` | attribute key (`attribute`, `category_attribute`) |
| 6 | `attribute_value` | `wartosc_atrybutu` | option code (`attribute`, `category_attribute`) |
| 7 | `min_quantity` | `od_ilosci` | integer ≥ 1 |
| 8 | `max_quantity` | `do_ilosci` | integer ≥ `min_quantity`, or empty |
| 9 | `price_kind` | `typ_ceny` | `fixed`, `percent`, `amount` (`stala`, `procent`, `kwota`) |
| 10 | `value` | `wartosc` | `fixed`: ≥ 0, ≤ 4 decimals; `percent`: −100…1000, ≤ 2 decimals, sign required for non-zero; `amount`: signed, ≤ 4 decimals |

Columns 2–6 are the natural key of P1's G10 (`priceBookNaturalKeySchema`): a line maps to one
`PriceBookBatchRowInput` with `key` set and `selection` absent. An unknown header, a missing required
header or a duplicated one refuses the file before parsing (FR-038). Empty trailing lines are ignored.
Header names are read case- and space-insensitively. The one column accepted beyond the ten is a last
`reason` / `powod` column — the one the refused-rows download adds — which is ignored, so a corrected
refused-rows file imports as it is (implemented 2026-10-23, T092).

## Import flow

1. Local checks: size, encoding, header, per-line syntax (kind, numbers, required key columns for the
   kind). Local errors are reported with the file line and never sent.
2. `PUT /api/v1/admin/price-books/:id/rows?dryRun=true` with `{ mode, upsert: [...] }` (merge by
   default; replace on request). The answer's `errors[]` (`index` = position in `upsert`) are mapped
   back to file lines; `diff` gives added / changed / removed / unchanged. Each error names its rule in
   `reason` (`PRICE_BOOK_ROW_ERROR_REASONS`, coordinator ruling at Checkpoint 11), which the admin
   translates; the English `message` is never shown.
3. Confirm is enabled only with zero local and zero server errors (FR-041); it sends the same body
   without `dryRun` and with `expectedVersion` = the preview's `version`. `409 PRICE_BOOK_STALE`
   discards the preview and offers a new one.
4. *Download refused rows* writes the refused lines in the same format plus a `reason` / `powod` column.
