---
'@endora-commerce/platform': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-taxes': minor
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-promotions': minor
'@endora-commerce/mod-cms': minor
---

The sales-channel bridge tables are declared by the modules that own them, not by the platform.

**`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
`ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
`ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

For a consumer the visible change is at the call site: a membership call for an entity type **no
installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
`error.details`, **before** it reaches the database. It previously executed SQL against the table
the map named, which on an instance that never installed the owning module is a relation that does
not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
is unchanged and stays the published vocabulary; the registry decides which of its members are
live.

`SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

**The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
and `category`); the other seven own one each. The registration is a contribution and carries no
presence probe: the rows outlive an operator switching the module off, so the bridge stays
readable, exactly as the asset-reference and language-reference registries state for their own
contributions.

**`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
since the membership service moved into the kernel. It is gone; the service takes the registry as a
new required constructor argument, in fifth position, and the delete sweep iterates the bridges
that are actually registered — so a channel can be deleted on an instance that never installed
`cms`.
