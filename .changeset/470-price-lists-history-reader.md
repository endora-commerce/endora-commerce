---
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/contracts': minor
---

Issue #470, third stage: the admin API reads a price book's price-change history. Three new reads, behind `price_lists:read`:

- `GET /api/v1/admin/price-books/:id/price-history`: the book's value changes, newest first, each with its action, actor, time, changed header values and line count.
- `GET /api/v1/admin/price-books/:id/price-history/:changeId/lines`: one change's lines in order, with the row's selection, quantity window and both sides of its price.
- `GET /api/v1/admin/price-books/:id/price-history/products/:productId`: one product's lines, its variants' included, newest first.

The reads are keyset-paged, `{ data, pagination: { cursor, hasMore, limit } }` (50 by default, at most 200), unlike the other price-book lists. Amounts are the stored decimal strings, never rounded. A book the caller cannot see answers `404` like an unknown one. For a caller limited to some organizations, organization ids outside their reach are left out of a recorded audience and counted in `withheldMemberCount`. The actor's id and name are served for an administrator only. Answers carry ids, not labels. The history starts with the release that first wrote it.

The schemas are in `@endora-commerce/contracts` (`priceBookHistory*`). `price_lists` now declares `admin_users` as a dependency, for the actor names.
