---
'@endora-commerce/mod-payments': minor
'@endora-commerce/contracts': patch
---

A payment retry or settlement refused by the payment's own state has an error code of its own
instead of `VALIDATION_FAILED`, and a sentence in English and Polish (issue #630, part of #86).
**A caller that matches on `VALIDATION_FAILED` here now sees the specific code.** The HTTP status
is unchanged. Until now an operator working in Polish read English, because the error envelope
never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/orders/:id/payments/retry` (and the buyer's retry past its own gates) | `409 VALIDATION_FAILED`, *Order is already paid; nothing to retry.* | `409 PAYMENT_ALREADY_PAID` | `code: 'retry'`, `orderId`, `paymentId`, `status` |
| the same | `409 VALIDATION_FAILED`, *This payment has been refunded; it cannot be retried.* | `409 PAYMENT_REFUNDED` | `orderId`, `paymentId`, `status` (`refunded` / `partially_refunded`) |
| the same | `409 VALIDATION_FAILED`, *This order is settled out of band; there is nothing to retry.* | `409 PAYMENT_SETTLED_OUT_OF_BAND` | `orderId`, `paymentId` |
| `POST /api/v1/payments/receive` with `outcome: "failure"` | `409 VALIDATION_FAILED`, *Payment is already settled; it cannot be marked failed.* | `409 PAYMENT_ALREADY_PAID` | `code: 'mark_failed'`, `orderId`, `paymentId`, `status` |

A retry of a paid order and the ingress marking a paid payment failed refuse the same state from
two callers, so they share one code and the token picks the sentence. The storefront's order page
names the three codes when its pay-again lands on one. The three codes are members of
`ERROR_CODES` in `@endora-commerce/contracts`, declared by the `payments` manifest, and the
module's documentation page lists them. No setting, permission or migration changes.
