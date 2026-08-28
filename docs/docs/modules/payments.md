---
title: payments
---

# `payments`

Payment driver dispatch + settlement events. The module owns the driver
port (`gateway-adapter-port.ts`) and concrete in-tree drivers; per-vendor
adapters live in dedicated integration modules.

## Drivers

| Driver | Behaviour |
| --- | --- |
| `bank-transfer-driver.ts` | Returns `NextAction.kind='awaiting_transfer'`; settlement happens out-of-band when the operator marks the order paid |
| `pickup-driver.ts` | `NextAction.kind='none'` for cash-on-pickup |
| `credit-limit-driver.ts` | Calls `CreditLimitService.reserve` inside the order-placement transaction (US6) |
| `gateway-adapter-port.ts` | Interface stub for external gateways; per-vendor implementations live outside the core |

## Public surface

Three admin routes, gated on this module's own permission codes:

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/orders/:id/payments` | `payments:read` | Full payment history for one order, including each attempt's provider payload |
| `POST /api/v1/admin/orders/:id/payments/retry` | `payments:write` | Opens the next `Payment` attempt on an order |
| `POST /api/v1/payments/receive` | `payments:write` | The `receive_payment` settlement ingress: declares a payment succeeded or failed |

The pair is deliberate. Reading an order's payment history is support and
finance work; opening a retry and declaring a settlement are money operations,
and an operator organisation separates the two. There is no third code for the
settlement ingress even though it is the most dangerous of the three, because
that route is transitional pending a signed PSP-webhook auth path — see the
reasoning in `manifest.ts`.

Until `payments` declared these, all three routes were gated on `catalog:read`
and `catalog:write`, so an operator who could edit a product could read every
payment's provider payload and mark an arbitrary payment settled. **Upgrading:
a role that was reading payment data through `catalog:read` must be granted
`payments:read` explicitly on `/admin-roles`** — there is no migration, because
one granting `payments:read` to every holder of `catalog:read` would reproduce
exactly the over-grant this change removes.

The ingress body bounds its `providerDetails` to a flat map of scalars
(`operatorProviderDetailsSchema`): the column is persisted verbatim and served
back in full, so what an operator may write into it is bounded by our schema
rather than by the caller's payload. Gateway integrations build the payload in
code and are not subject to that bound.

Beyond the routes, orders consume the drivers via
`order-service.ts#placeOrder()`, and admin payment-status mutations go through
`/api/v1/admin/orders/:id/payment-status`, which `orders` owns.

The buyer's own retry (`POST /api/v1/orders/:orderId/payments/retry`) is a
customer route and authorises through `requireCustomer`, not a permission.

## Events emitted

`payment.settled.v1`, `payment.failed.v1`, `payment.refunded.v1`.

## Extension points

- **New gateway** — implement `gateway-adapter-port.ts`, register the
  driver in the composition root, expose a configuration through the
  `integrations` module.
- **Fraud / 3DS hooks** — slot in front of the driver's `reserve` call
  before the order-placement transaction commits.
