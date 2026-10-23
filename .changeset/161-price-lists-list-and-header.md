---
'@endora-commerce/mod-price-lists': minor
---

The price-book editor's first screens (feature 161, US1; FR-001–FR-005).

- **`/price-lists` — the book list.** Filters by name, type, status, currency, sales channel, audience kind and member, all kept in the URL; columns for type, status, currency, channels, audience, priority and price rows; *applies to no one* and *applies nowhere* flags; base books marked *Base prices — PLN*; a delete (confirmed, naming the book and its row count) only on books the caller may change and never on a base book; loading, empty, filtered-empty and error states.
- **`/price-lists/new` — the create flow.** Five steps (name and type, currency, sales channels, audience, schedule and priority); only channels selling in the currency are offered and the others are named with the reason; only the audience kinds the caller may create; members picked through the scope-filtered targets; the book is created as a draft and opened. A refusal returns to the step that owns the field.
- **`/price-lists/:id` — the header.** Name, channels (dormant bindings explained), members, schedule and priority edited and saved against the book's version (`409 PRICE_BOOK_STALE` keeps the edits and offers a reload); currency and, once active, audience kind read-only; activate and move to draft, a refused activation naming what is missing with a way to the field; delete; history link to the audit log; read-only for a caller who may not change the book; the not-found page for an unknown or hidden book.
- The package now declares `react-router-dom` (`^7`, optional peer) for its admin layer.
