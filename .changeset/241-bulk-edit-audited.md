---
'@endora-commerce/mod-catalog': patch
---

A product bulk edit now writes each product through the `product.update` Command, the same one a single-product edit runs. Each product gets its own audit entry in the same transaction as its write, and the actor is the admin, or the requester a queued operation acts for. Before this change the entry was recorded by hand after the write.

A product update that changes nothing no longer writes an audit entry and no longer emits `product.updated.v1`. This applies to the bulk edit, the admin product update, the API-key update by SKU and the catalog write port. A field now counts as changed only when its stored value moves, so `changedFields` no longer lists a field that was sent with the value it already had. The product's editor version still moves on such a write.

`CatalogAdminService.updateProduct` no longer takes an audit context: it is the unaudited path, reached only when no Command Bus is composed. Its signature is now `(id, req, gate?)`.

A bulk edit now refuses to run when no Command Bus is composed, rather than writing products unaudited. `CatalogBulkUpdateService.bulkUpdate` throws an internal error, and `CatalogAdminService.hasCommandBus()` reports whether a bus is present. Without a bus, the assistant is offered no catalog mutation tool. Before this change it lost only Archive and Restore.
