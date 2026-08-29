---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-shipments': minor
---

`StartShipmentResult` lets an adapter name the carrier reference it just obtained.

`{ kind: 'pending' }` and `{ kind: 'generated' }` both accept `externalReference?: string | null`
and `providerDetails?: Record<string, unknown>`, and `ShipmentService.createShipment` applies
them on the **open create transaction** — a forked EntityManager inside an adapter cannot see
the uncommitted row, so an adapter that wrote there wrote nothing.

`OrderCreatedContext` gains `shippingAdapterData`, `deliveryPhone` and `customerEmail`, all
from the in-transaction order snapshot, for the same reason: an adapter must not re-fetch the
order to validate a checkout that has not committed.

`ShippingAdapter.shouldAutoCreateOnPaid?()` is new and optional: when it answers true,
`shipments` opens a shipment on `payment.received.v1`. Absent or false for every built-in
offline adapter, so nothing changes for an adapter that does not implement it.

**Not a breaking change for an existing adapter**: a `{ kind: 'generated', trackingNumber }`
result still deposits that tracking number, which is what `@endora-commerce/mod-dhl-parcel`'s
two adapters return. `externalReference` wins where both are named.
