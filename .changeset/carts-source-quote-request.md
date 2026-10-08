---
'@endora-commerce/mod-carts': minor
---

A basket remembers the accepted quote request it was seeded from.

- **One new nullable column, `carts.source_quote_request_id`**, arriving with the next
  migration run (`Migration20261008T061751CartsCartSourceQuoteRequest`). No backfill, no
  foreign key, no index; existing baskets hold `null`.
- `cartWritePort.replaceItemsForCustomer` accepts `{ sourceQuoteRequestId }` as an optional
  third argument and stores it; a call without it clears the mark. Nothing a buyer can reach
  sets it. Adding a line, removing one or changing a quantity keeps it, as it keeps the unit
  prices the seed wrote; **removing the last line clears it**.
- `CartRecord`, as answered by `cartReadPort`, `cartWritePort` and `cartPlacementApplyPort`,
  carries `sourceQuoteRequestId`.
- **Fixed:** `replaceItemsForCustomer` did not write the basket's `lastActivityAt` — it set it
  on a row another `EntityManager` managed. A basket seeded by a reorder, an
  administrator-created order or a quote conversion now has its activity time moved, which
  the abandonment sweep reads.

No route, no response shape and no manifest edge changes.
