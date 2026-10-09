---
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/contracts': minor
---

The adapter of a delivery method is chosen on `/delivery-methods`. The screen only displayed it:
a method created there was sent without one, the API took the method's code as the adapter, and a
code no module had registered gave a row that saved without a word and that
`GET /api/v1/delivery-methods` never offered at checkout.

- **`GET /api/v1/admin/delivery-methods/adapters`** (gated `delivery_methods:read`) answers
  `{ data: [{ key, ownerModule }] }` — every registered shipping adapter whose module is switched
  on. `@endora-commerce/contracts` exports its shape as `deliveryMethodAdapterOptionSchema` /
  `DeliveryMethodAdapterOption`.
- **Every row of `GET /api/v1/admin/delivery-methods`, and the body `PUT` answers with, carries
  `availability: { ownerModule, available, ownerPresence }`** — the same three fields payment
  methods already report. `available: false` is a method checkout does not offer.
  `@endora-commerce/contracts` exports `deliveryMethodAvailabilitySchema` and
  `deliveryMethodAdminListItemSchema` with their types. `deliveryMethodAdminSchema` is unchanged.
- The form has a required **Adapter** select, listing the bundled adapters by name and a carrier
  module's by key. A row checkout cannot offer is marked *Not offered at checkout* with the reason,
  and is repaired by opening it and choosing a registered adapter. Nothing is rewritten or deleted
  automatically.

Two changes to `PUT /api/v1/admin/delivery-methods/:code`:

- **Changing the adapter of a method that shipments reference answers 409.** A shipment records
  its delivery method and not the adapter that opened it, so the method's adapter is the only
  record of which carrier holds those parcels. Set the method `inactive` and create another for the
  other adapter. While the `shipments` module is switched off the change is refused as well, as a
  delete already is. A body that omits `adapter`, or repeats the one the row has, is unaffected.
- **An `adapter` the row already carries is accepted even when it is not registered**, so a method
  whose carrier module is gone can still be re-priced or deactivated by a client that sends the
  whole row back. Changing a method *to* an unregistered adapter still answers 400.

A body that omits `adapter` on creation still takes the method's code as the adapter. Send it
explicitly, and read `availability.available` in the response.
