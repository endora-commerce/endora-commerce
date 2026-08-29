---
'@endora-commerce/contracts': minor
---

`OrderReadPort` gains `salesChannelIdsForCustomer(customerAccountId)`, the distinct sales
channels one customer has ordered on:

```ts
salesChannelIdsForCustomer(customerAccountId: string): Promise<string[]>;
```

The ids come back already distinct, most recently ordered-on first, and a customer with no
orders answers `[]`. Consumers resolving the port under the container name `orderReadPort`
need no change; the method is additive for them.

It is the read the admin customer-detail header used to answer with `em.find(Order, {
placedByCustomerAccountId }, { fields: ['salesChannelId'] })` from inside the `customers`
module — a plain read of another module's table, so it becomes a **read-port method** and not
an `EntityManager`-taking apply port: handing a read a transaction handle re-opens a write seam
to serve it. It is deliberately not `OrderListPort.list` with a `placedByCustomerAccountId`,
which is paginated: the channels that read yields are the channels on one page, and a detail
header that silently narrowed with the page size would be a different fact under the same
label.

`minor` rather than `major` because the only party that has to change is the port's
**provider**, and a port in this package has exactly one — the module that publishes it. If you
implement `OrderReadPort` yourself, add the method: it takes a customer account id and answers
the distinct channel ids of that customer's orders, newest first.
