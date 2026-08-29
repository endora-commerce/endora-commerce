---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-shipments': minor
---

`shipments` publishes `shipmentReadPort`, and `@endora-commerce/contracts` gains
`ShipmentReadPort` and `ShipmentRecord`.

```ts
interface ShipmentReadPort {
  findById(id: string): Promise<ShipmentRecord | null>;
  findByExternalReference(reference: string): Promise<ShipmentRecord | null>;
}
```

For a carrier module, which asks about a shipment twice and could previously only do it
by loading `shipments`' entity: when an inbound webhook names only the carrier's own id,
and when an admin asks for the label of an attempt. `findByExternalReference` is not a
duplicate of `findById` — a carrier that signs nothing and names only its own id has to be
correlated, and until the first `receive_shipment` lands, `externalReference` is where the
adapter put that id.

Resolve it as `lazyPort<ShipmentReadPort>(ctx, 'shipmentReadPort')` with `shipments` in
your manifest `dependencies`. Nothing is removed; `shipmentService` and `shipmentUsagePort`
are unchanged.
