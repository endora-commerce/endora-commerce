---
'@endora-commerce/mod-delivery-methods': minor
'@endora-commerce/contracts': patch
---

The delivery-method shipment guard has error codes of its own instead of `VALIDATION_FAILED`,
and a sentence in English and Polish (issue #632, part of #86). **A caller that matches on
`VALIDATION_FAILED` for these refusals now sees the specific code.** The HTTP status is unchanged.
Until now each was answered with an English sentence in every language, because the error
envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `DELETE /api/v1/admin/delivery-methods/:id` | `409 VALIDATION_FAILED`, *"Cannot delete delivery method: N shipment(s) reference it. …"* | `409 DELIVERY_METHOD_IN_USE` | `code: "delete"`, `deliveryMethodId`, `deliveryMethodCode`, `shipmentCount` |
| `PUT /api/v1/admin/delivery-methods/:code` (adapter changed) | `409 VALIDATION_FAILED`, *"Cannot change the adapter of delivery method … N shipment(s) were created against it …"* | `409 DELIVERY_METHOD_IN_USE` | `code: "change_adapter"`, `deliveryMethodId`, `deliveryMethodCode`, `adapter`, `shipmentCount` |
| `DELETE /api/v1/admin/delivery-methods/:id`, `shipments` off | `409 VALIDATION_FAILED`, *"Cannot delete delivery method: the "shipments" module is switched off, …"* | `409 DELIVERY_METHOD_USAGE_UNKNOWN` | `code: "delete"`, `deliveryMethodId`, `module: "shipments"` |
| `PUT /api/v1/admin/delivery-methods/:code` (adapter changed), `shipments` off | `409 VALIDATION_FAILED`, *"Cannot change the adapter of this delivery method: the "shipments" module is switched off, …"* | `409 DELIVERY_METHOD_USAGE_UNKNOWN` | `code: "change_adapter"`, `deliveryMethodId`, `module: "shipments"` |

`details.code` is a token naming the refused write, and each token has its own sentence. The
method's own code travels as `deliveryMethodCode`, because `details.code` is the token. Both codes
are members of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `delivery_methods`
manifest, and the module's documentation page names them. No setting, permission or migration
changes.
