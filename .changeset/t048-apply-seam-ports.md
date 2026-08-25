---
"@endora-commerce/contracts": patch
---

`CartReadPort`'s doc block no longer says the port has no consumer.

No exported symbol changes. The block asserted that `orders`' basket read could
not be served by this port and that the boundary question behind it was open;
feature 080's T048 settles it by splitting the seam in two, so the sentence a
consumer reads in their editor was describing a state of the tree that no longer
exists. `orders`' storefront total preview is the consumer, named in the block.

The transactional half — the basket read that belongs with the completion order
placement performs — is `CartPlacementApplyPort`, and it is deliberately not in
this package: both of its methods take a MikroORM `EntityManager`, which
`packages/contracts` may not name because `admin` and `storefront` both compile
it (FR-034). It lives on its owner's own `ports/` surface.
