---
'@endora-commerce/contracts': minor
---

A Line items table column can print its value as a link (issue #1904). New `documentCellLink(link, field, item)` answers the absolute `http(s)` address a cell links to, or `null` for plain text; the PDF renderer and the editor canvas both ask it. `DocumentFieldDefinition` gains the optional `linkPath` — the field of the same collection holding the page this field links to — and `documentFieldDefinitionSchema` accepts it. `itemsTableColumnSchema` gains `link` (a boolean, `'true'` / `'false'` as Puck stores it), defaulting to `false`, so a layout saved before it prints unchanged. `quoteRequestDocumentDataSchema`'s lines gain `productUrl` (a string or `null`, defaulting to `null`), the product's storefront page.
