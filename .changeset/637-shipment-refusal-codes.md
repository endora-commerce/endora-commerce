---
'@endora-commerce/mod-shipments': minor
'@endora-commerce/contracts': patch
---

The two shipment-state refusals have an error code of their own instead of `VALIDATION_FAILED`,
and a sentence in English and Polish (issue #637, part of #86). **A caller that matches on
`VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
Until now each was answered with an English literal in every language, because the error
envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/orders/:id/shipments` | `409 VALIDATION_FAILED`, *"Order already has a successful shipment; nothing to generate."* | `409 SHIPMENT_ALREADY_GENERATED` | `code: "generate"`, `orderId`, `shipmentId` |
| `POST /api/v1/shipments/receive` with `outcome: "failure"` | `409 VALIDATION_FAILED`, *"Shipment is already generated; it cannot be marked failed."* | `409 SHIPMENT_ALREADY_GENERATED` | `code: "mark_failed"`, `shipmentId`, `orderId`, `status` |

`details.code` is a token naming the refused write, and each token has its own sentence. The code
is a member of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `shipments` manifest
(the module's first error code), and the module's documentation page names it. No setting,
permission or migration changes.
