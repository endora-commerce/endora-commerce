---
'@endora-commerce/mod-price-lists': minor
---

The price-book grid (feature 161, US2; FR-006–FR-017, FR-036, FR-037) on `/price-lists/:id?tab=prices`; the book page now has *Settings* and *Prices* tabs (`?tab=prices` opens the prices).

- One line per selection, general to specific, one column per quantity tier; each price's kind in words and an icon, a percentage with its reference (*of base* on a catalogue book, *of catalogue price* otherwise); an empty cell says what it inherits from the line's lower tier, a variant cell what its product line gives, or that the line does not price the quantity.
- Pages of 50, 100 or 200 **lines** from `GET …/lines`, with the total and page numbers; search and line kind sent to the server; edits kept across pages.
- Lines added through the product browser (many at once, none twice among the loaded lines) and through category, attribute-value and category ∩ attribute-value pickers (eligible attributes only); a product line expands to its catalogue variants.
- Typing and pasting read prices liberally (decimal comma, spaces, currency, Unicode minus); refused text stays in its cell with the reason; bulk changes (set percentage, set adjustment, multiply fixed prices, clear) are one undo step; a cell detail sets a quantity window outside the columns or clears the cell.
- One batch per save against the opened version, with progress and a live announcement; tier windows are re-chained so a new tier ends the one below; every refused cell is marked; a stale book is reloaded with the edits kept to re-apply or discard; a save past 5 000 rows on a non-base book is refused before it is sent; leaving with unsaved prices asks first.
- Admin library: `book-edit-state.ts` (cells, windows, the batch, error mapping, rebase), `bulk.ts`, `grid-labels.ts`; the API client gains `productVariants(productId)`.
