---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-orders': minor
---

`OrderRecord` gains `shippingAdapterData?: Record<string, unknown> | null`, and
`orderReadPort` projects it.

The adapter-specific shipping envelope captured at placement (feature 068). Opaque on the
record on purpose: only the delivery method's own `ShippingAdapter` knows its shape, and
the reader that needs it is that same adapter reading back what it wrote. It is published
so a carrier module can read the order it is shipping over `OrderReadPort` instead of
importing `orders`' entity.

Additive: no existing field moves and no caller has to change.
