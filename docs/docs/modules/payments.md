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

This module exposes no direct HTTP routes — orders consume the drivers via
`order-service.ts#placeOrder()` and admin payment-status mutations via
`/api/v1/admin/orders/:id/payment-status`.

## Events emitted

`payment.settled.v1`, `payment.failed.v1`, `payment.refunded.v1`.

## Extension points

- **New gateway** — implement `gateway-adapter-port.ts`, register the
  driver in the composition root, expose a configuration through the
  `integrations` module.
- **Fraud / 3DS hooks** — slot in front of the driver's `reserve` call
  before the order-placement transaction commits.
