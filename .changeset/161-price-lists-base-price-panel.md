---
'@endora-commerce/mod-price-lists': minor
---

The product editor's base-price panel (feature 161, US3; FR-019–FR-021) in `product.editor.pricing.after`, replacing the Phase 3 shell.

- One line per currency a sales channel offers: the price from 1 and further tiers (each starting above the one before; windows chained on save), and per variant *inherits* / own price / signed percentage / signed amount, with a labelled preview rounded by the contracts' decimal helpers; a notice when the product has no base price and cannot be ordered, and per currency without one.
- Its own *Save prices*: one `PUT /api/v1/admin/price-books/base-prices/:productId` of the changed currencies, with progress, no double submit and a live announcement; refused values marked on their fields; the unsaved-changes prompt on leaving the page and the product editor's other tabs. Read-only when `writable` is false.
- Below it, read-only, the books that price the product directly (`GET …/price-books?productId=`), with audience and price, linked to the book and to *Why this price?*.
