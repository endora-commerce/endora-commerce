---
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-payment-methods': patch
---

Both modules' activation-control descriptions now say what switching them off does to a
shop, not only which surfaces disappear.

No code, schema, export or manifest field other than the `description` string changes. The
descriptions were accurate and stopped one step short of the consequence: *"the public list
a checkout picks from"* is exactly right, and what it means is that order placement answers
`Delivery method is not active` / `Payment method is not active` and the shop takes no
orders at all. An operator deciding whether to flip a switch reads the switch, so that
sentence has to be there.

If you render either description in your own operator surface, it is longer by one
sentence.
