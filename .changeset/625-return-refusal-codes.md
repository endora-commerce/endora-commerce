---
'@endora-commerce/mod-returns': minor
'@endora-commerce/contracts': patch
---

Thirteen `returns` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #625, part of #86). **A caller that matches on
`VALIDATION_FAILED`, or on the reason in `details.code`, now sees the specific code.** The HTTP
status is unchanged. Until now the buyer and the operator read the thrower's English sentence
whatever language they asked for, because the error envelope never replaces the message of
`VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/returns` | `422 VALIDATION_FAILED`, `details.code` `order_not_completing` | `422 RETURN_ORDER_NOT_ELIGIBLE` | `orderId` |
| `POST /api/v1/returns` | `422 VALIDATION_FAILED`, `details.code` `qty_exceeds_returnable` | `422 RETURN_QUANTITY_EXCEEDS_RETURNABLE` | `orderItemId`, `requested`, `remaining` |
| `POST /api/v1/returns`, a reason that exists but is switched off | `422 VALIDATION_FAILED`, `details.code` `unknown_reason` | `422 RETURN_REASON_INACTIVE` | `reasonId` |
| `POST /api/v1/returns/:id/comments`, `POST /api/v1/admin/returns/:id/comments` | `409 VALIDATION_FAILED`, `details.code` `case_terminal` | `409 RETURN_COMMENTS_CLOSED` | `returnCaseId`, `statusCode` |
| `POST /api/v1/returns/:id/select-delivery-method`, a finished case | `409 VALIDATION_FAILED`, `details.code` `case_terminal` | `409 RETURN_CASE_CLOSED` | `returnCaseId`, `statusCode` |
| `POST /api/v1/returns/:id/select-delivery-method`, a method not offered | `422 VALIDATION_FAILED`, `details.code` `method_not_allowed` | `422 RETURN_DELIVERY_METHOD_UNAVAILABLE` | `returnDeliveryMethodId` |
| `POST /api/v1/admin/returns/:id/settlement` | `409 VALIDATION_FAILED`, `details.code` `settlement_in_progress` | `409 RETURN_SETTLEMENT_IN_PROGRESS` | `orderId` |
| `POST /api/v1/admin/returns/:id/settlement`, a line | `422 VALIDATION_FAILED`, `details.code` `refund_exceeds_paid` | `422 RETURN_REFUND_EXCEEDS_PAID` | `returnCaseItemId`, `requested`, `maximum` (two-decimal strings), `currency` |
| `POST /api/v1/admin/returns/:id/settlement`, the delivery or the payment surcharge | `422 VALIDATION_FAILED`, `details.code` `refund_exceeds_paid` | `422 RETURN_REFUND_EXCEEDS_PAID` | `code: 'delivery'` or `'surcharge'`, `requested`, `maximum`, `currency` |
| `POST /api/v1/admin/returns/:id/settlement` | `502 VALIDATION_FAILED`, message = the gateway's `failureReason`, `details.code` `gateway_refund_failed` | `502 RETURN_REFUND_GATEWAY_FAILED` | `settlementState`, `failureReason`, `providerDetails` |
| `POST /api/v1/admin/returns/statuses` | `409 VALIDATION_FAILED`, *Status "X" already exists.* | `409 RETURN_STATUS_CODE_TAKEN` | `statusCode` |
| `PATCH /api/v1/admin/returns/statuses/:code` | `409 VALIDATION_FAILED`, *Cannot mark "X" terminal while it has outgoing transitions.* | `409 RETURN_STATUS_TERMINAL_HAS_TRANSITIONS` | `code: 'mark_terminal'`, `statusCode`, `outgoingCount` |
| `PUT /api/v1/admin/returns/transitions` | `422 VALIDATION_FAILED`, *Terminal status "X" cannot have outgoing transitions.* | `422 RETURN_STATUS_TERMINAL_HAS_TRANSITIONS` | `code: 'add_transition'`, `statusCode`, `toStatusCode` |
| `DELETE /api/v1/admin/returns/statuses/:code` | `409 VALIDATION_FAILED`, *The initial status cannot be deleted.* | `409 RETURN_STATUS_NOT_DELETABLE` | `code: 'initial'`, `statusCode` |
| `DELETE /api/v1/admin/returns/statuses/:code` | `409 VALIDATION_FAILED`, *Cannot delete status "X" while N case(s) use it.* | `409 RETURN_STATUS_IN_USE` | `statusCode`, `caseCount` |

The status code travels as `details.statusCode`, because `details.code` is the slot for a
refusal's token. The gateway's own words are `details.failureReason` and never the sentence. An
unknown order line or return line, a reason id that names nothing (`unknown_reason`), a missing
refund payment method, a blank rejection reason and a transition naming a status that does not
exist stay `VALIDATION_FAILED`. The thirteen codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `returns` manifest, and the module's documentation
page lists them. No setting, permission or migration changes.
