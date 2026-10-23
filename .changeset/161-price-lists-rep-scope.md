---
'@endora-commerce/mod-price-lists': patch
---

A price book's *Duplicate* is offered only on a book the caller may change (feature 161, US8; FR-027, A3.3). Old: any operator holding `price_lists:write` saw *Duplicate* on every non-base book, including an everyone or customer-group book a sales representative may only read. New: it needs the book's `writable` as well, like every other edit control on the page.
