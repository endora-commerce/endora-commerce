---
'@endora-commerce/contracts': minor
---

`grossPartsAtRowTarget` (with `GrossPartAtRate`) places amounts given as a gross at a VAT rate on a
document beside its goods: each part's net is the row-target net under `vatByRate`'s rule, less
the row's net so far, so no second VAT computation exists. A negative gross goes through it the
same way. `OrderReturnedQuantity` gains an optional `retained`, what settled returns withheld for
the line (issue #854), and its `discount` is now each returned line's whole default discount.
Both changes are additive for a reader; an implementor of `ReturnRefundReadPort` that sends no
`retained` reports nothing withheld.
