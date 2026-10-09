---
'@endora-commerce/mod-orders': patch
---

`order.created.v1` and `promotion.used.v1` are emitted after the transaction that places the order
has committed. They were emitted from inside it, and no placement path — storefront checkout,
one-click buy, external order intake, an order an administrator creates — runs in an event scope
that would have buffered them, so subscribers ran before the commit. A subscriber reading on a
connection of its own could find no order, and a placement that failed after that point had
already been announced: the webhook bridge had enqueued an `order.created.v1` delivery for an
order that was then rolled back.

A placement that fails now announces nothing. The payloads are unchanged. A caller that places an
order inside an event scope of its own still has the events buffered until that scope ends.
