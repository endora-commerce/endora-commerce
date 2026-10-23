---
'@endora-commerce/mod-price-lists': minor
---

Duplicating a price book and explaining a price (feature 161, US4 and US5; FR-022–FR-024).

- **Duplicate** on a book's header (`price_lists:write`, not on a base book): a dialog pre-filled with "… (copy)", the source's channels, currency and audience and a multiplier of 1; a chosen channel that does not sell in a changed currency is flagged before anything is sent; percentages are copied unchanged; `POST …/:id/duplicate`, then the draft copy opens. The source is never written.
- **`/price-lists/explain`** — the price explainer: sales channel, currency, buyer (guest, organization from the scope-filtered targets, or customer with `customers:read`) and lines (product, variant, quantity); per line the price, its source, the cell in words, the book and the row (linked into the grid), the reference price, the precedence version and the runner-ups by name; a sale with the regular price it beat; an unpriced line with a link to set a base price. Pre-filled from `productId`, `variantId`, `organizationId` and `bookId` (the book's channel, currency and only organization).
- **Entry points:** *Explain a price* on a book's header, *Why this price?* in a grid cell's detail and the product's base-price panel, and *Explain a price for this organization* in the organization detail's zone.
- The book's price grid opens on `?tab=prices&search=…`, so a link can land on a row's line.
