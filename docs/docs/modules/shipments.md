---
title: shipments
---

# `shipments`

The `Shipment` record and its lifecycle (feature 035 — _Metoda Dostawy_). The
delivery-side twin of `payments`: the shipping-method *catalog* and adapter
registry live in [`delivery_methods`](./delivery_methods.md); this module owns
the first-class, retryable `Shipment` and the `receive_shipment` ingress.

## Entity

`Shipment` — one shipment-generation attempt against an Order:
`orderId`, `deliveryMethodId`, `status` (`pending` → `success` | `failure`),
`externalReference`, `providerDetails` (JSONB), `failureReason`, `attemptNo`,
timestamps. An Order may have many Shipments (failed-generation retries; a
future split into multiple parcels). The `status` here is the shipment-process
status, distinct from the Order status the method maps to.

## Lifecycle

| Event | Trigger | Effect |
| --- | --- | --- |
| `order_created` | Order created (storefront / admin / API) | The shipping adapter's `onOrderCreated` fires. Offline adapters are no-ops; **no** Shipment is opened here. |
| `shipment_created` | Admin "Generate shipment" / API | A `pending` Shipment is opened (`attemptNo = max+1`); the adapter's `onShipmentCreated` runs; `shipment.created.v1` is emitted. |
| `receive_shipment` | Carrier/adapter ingress | The Shipment is resolved; the Order moves to the method's `statusOnSuccess` / `statusOnFailure`; `shipment.received.v1` / `shipment.failed.v1` is emitted. |

`receive_shipment` is **idempotent**: a success after a terminal `success` is a
no-op; a failure after success is rejected (409, no downgrade); a missing /
already-resolved reference is rejected without corrupting records. A failed
generation is retried by opening a new Shipment, leaving prior attempts intact.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/admin/orders/:id/shipments` | admin (`orders:write`) | Generate a shipment (`shipment_created`) |
| `GET /api/v1/admin/orders/:id/shipments` | admin (`orders:read`) | Full shipment history for the order |
| `POST /api/v1/admin/orders/:id/shipments/retry` | admin (`orders:write`) | Open a retry Shipment after a failure |
| `POST /api/v1/shipments/receive` | adapter/carrier ingress (admin-guarded for MVP) | `receive_shipment` outcome ingress |

## Order-status mapping

On a `receive_shipment` outcome the handler writes `orders.status` directly
(bypassing the `transitionStatus` state graph) to the method's `statusOnSuccess`
/ `statusOnFailure`, validated through the `OrderStatusRegistry` port owned by
`delivery_methods`. Emitted events flow on the in-process `EventBus` inside the
handler's transactional scope, so a rolled-back transaction never dispatches.
