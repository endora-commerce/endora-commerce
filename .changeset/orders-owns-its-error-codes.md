---
'@endora-commerce/mod-orders': patch
---

`orders` declares the two error codes it owns.

`manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
(`specs/090-module-owned-error-codes/`). Nothing the package exports changes
shape. The observable difference for a consumer is that this module's error
sentences are now routed by its own declaration rather than only by the prefix
chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
both of them: the list is the chain's own answer, copied from the frozen
capture, and is asserted equal to it in both directions.

No `tokens` are declared: neither code carries a refusal discriminator. Every
one of `ORDER_NOT_FOUND`'s fifteen raise sites is a three-argument
`new HttpError`, so nothing can put a `details.code` on the wire, and
`ORDER_NOT_CANCELLABLE` has no raise site at all.

The list is short and the module is not. This package throws eighteen distinct
error codes and owns exactly one of them — `INVOICE_NOT_READY` is `invoices`',
`CART_EMPTY` is `carts`', `STOCK_UNAVAILABLE` is `inventory`', and fourteen more
belong to the platform block. Ownership follows the domain noun and never the
thrower.
