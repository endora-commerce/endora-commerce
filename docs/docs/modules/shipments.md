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
`orderId`, `deliveryMethodId`, `status` (`pending` → `success` | `failure`, plus
`pending_manual`), `externalReference`, `providerDetails` (JSONB),
`failureReason`, `attemptNo`, timestamps. An Order may have many Shipments
(failed-generation retries; a future split into multiple parcels). The `status`
here is the shipment-process status, distinct from the Order status the method
maps to.

### `pending_manual` — the carrier was never asked

A shipment opens `pending_manual` when the adapter its delivery method names is
contributed by a module that is **not present** — switched off by the operator,
or not available in this deployment. The registry filters that adapter out at
enumeration (the contribution-point policy, D-39), so nothing is sent: no label,
no tracking number, no pickup. The row records what happened rather than looking
like every other shipment:

- `status = 'pending_manual'`, which is the same word — and the same instruction
  to the same operator — as a refund the platform could not settle automatically
  (feature 046, FR-035): *a human has to finish this*;
- `failureReason` names the module, e.g. `The "my_carrier" module is not
  switched on here, so the carrier was never asked to create this shipment.
  Switch the module back on and generate the shipment again.`;
- an audit entry `shipment.carrier_not_contacted` on the shipment, written
  co-transactionally with the row (Principle XIII);
- **no** `shipment_created` e-mail. The notifier answers
  `{ sent: false, reason: 'carrier_not_contacted' }` and logs it — telling a
  buyer their order has shipped when nothing was handed to anyone is worse than
  telling them nothing, and it is not a message anyone can take back.

It is deliberately **not** `failure` — nothing was rejected, because nothing was
sent — and deliberately not plain `pending`, which means a carrier that knows
about the shipment has yet to report back.

A delivery method whose adapter key **nobody ever contributed** is untouched: it
keeps opening `pending`, because there is no module to switch on and an offline
method has always been finished by hand. The two are told apart by
`ShippingAdapterRegistry.absentOwnerFor`, not by `get()` — which answers
`undefined` for both.

**Recovery is an operator action, not an automatic sweep.** Switching the module
back on changes nothing about the shipments already opened; the operator
generates the shipment again (`POST /api/v1/admin/orders/:id/shipments`), which
appends a new attempt and asks the carrier. Reacting to the activation setting
would mean the platform calling a carrier for parcels an operator may already
have handled by hand, without anyone asking it to. The Delivery tab of the order
surfaces the state, the reason and the button.

There used to be a second endpoint here, `POST .../shipments/retry`, and issue
#257 deleted it: it appended attempt n+1 and contacted no adapter in any state,
so an operator who used it got a fresh `pending` row that nothing had been asked
about. Retrying **is** generating again — the generate endpoint appends the next
attempt, refuses only once one has succeeded, and asks the carrier for it.

## Lifecycle

| Event | Trigger | Effect |
| --- | --- | --- |
| `order_created` | Order created (storefront / admin / API) | The shipping adapter's `onOrderCreated` fires. Offline adapters are no-ops; **no** Shipment is opened here. |
| `shipment_created` | Admin "Generate shipment" / API | A `pending` Shipment is opened (`attemptNo = max+1`); the adapter's `onShipmentCreated` runs; `shipment.created.v1` is emitted, carrying the state the row opened in. With the adapter's module absent the row opens `pending_manual` and no adapter is called — see above. |
| `receive_shipment` | Carrier/adapter ingress | The Shipment is resolved; the Order moves to the method's `statusOnSuccess` / `statusOnFailure`; `shipment.received.v1` / `shipment.failed.v1` is emitted. |

`receive_shipment` is **idempotent**: a success after a terminal `success` is a
no-op; a failure after success is rejected (409, no downgrade); a missing /
already-resolved reference is rejected without corrupting records. A failed
generation is retried by generating again, which opens the next Shipment attempt
and asks the carrier for it, leaving prior attempts intact.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/admin/orders/:id/shipments` | admin (`orders:write`) | Generate a shipment (`shipment_created`) — and retry a failed one, by generating the next attempt |
| `GET /api/v1/admin/orders/:id/shipments` | admin (`orders:read`) | Full shipment history for the order |
| `POST /api/v1/shipments/receive` | adapter/carrier ingress (admin-guarded for MVP) | `receive_shipment` outcome ingress |

## Order-status mapping

On a `receive_shipment` outcome the handler writes `orders.status` directly
(bypassing the `transitionStatus` state graph) to the method's `statusOnSuccess`
/ `statusOnFailure`, validated through the `OrderStatusRegistry` port owned by
`delivery_methods`. Emitted events flow on the in-process `EventBus` inside the
handler's transactional scope, so a rolled-back transaction never dispatches.
