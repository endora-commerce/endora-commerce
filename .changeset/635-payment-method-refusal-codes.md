---
'@endora-commerce/mod-payment-methods': minor
'@endora-commerce/contracts': patch
---

The payment-method delete guard has error codes of its own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #635, part of #86). **A caller that matches on
`VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
Until now each was answered with an English sentence in every language, because the error
envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `DELETE /api/v1/admin/payment-methods/:id` | `409 VALIDATION_FAILED`, *"Cannot delete payment method: N payment(s) reference it. …"* | `409 PAYMENT_METHOD_IN_USE` | `paymentMethodId`, `paymentMethodCode`, `paymentCount` |
| `DELETE /api/v1/admin/payment-methods/:id`, `payments` off | `409 VALIDATION_FAILED`, *"Cannot delete payment method: the payments module is switched off, …"* | `409 PAYMENT_METHOD_USAGE_UNKNOWN` | `paymentMethodId`, `module: "payments"` |

The method's own code travels as `paymentMethodCode` rather than `code`, because the error
envelope reads `details.code` as a refusal token. Both codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `payment_methods` manifest, and the module's
documentation page names them. No setting, permission or migration changes.
