---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-payment-methods': patch
---

Refusals on the buyer-facing and admin order paths have an error code of their own instead of
`VALIDATION_FAILED`, and a sentence in English and Polish (issue #86). **A client that matches on
`VALIDATION_FAILED` for these cases now sees the specific code.** The HTTP status of each is
unchanged. Until now each was answered with an English sentence in every language, because the
error envelope never replaces the message of `VALIDATION_FAILED`.

| Was | Is | `details` |
| --- | --- | --- |
| `400 VALIDATION_FAILED`, `details.code = "delivery_method_not_allowed_for_organization"` | `400 ORDER_DELIVERY_METHOD_UNAVAILABLE`, same `details.code` | `deliveryMethodId` (unchanged) |
| `400 VALIDATION_FAILED`, `details.code = "delivery_method_not_in_sales_channel"` | `400 ORDER_DELIVERY_METHOD_UNAVAILABLE`, same `details.code` | `deliveryMethodId`, `salesChannelId` (unchanged) |
| `400 VALIDATION_FAILED`, *"Delivery method is not active."* or *"The selected shipping method is not available for this order."* | `400 ORDER_DELIVERY_METHOD_UNAVAILABLE`, no `details.code` | `deliveryMethodId` (new) |
| `400 VALIDATION_FAILED`, `details.code = "payment_method_not_allowed_for_organization"` | `400 ORDER_PAYMENT_METHOD_UNAVAILABLE`, same `details.code` | `paymentMethodId` (unchanged) |
| `400 VALIDATION_FAILED`, `details.code = "payment_method_not_in_sales_channel"` | `400 ORDER_PAYMENT_METHOD_UNAVAILABLE`, same `details.code` | `paymentMethodId`, `salesChannelId` (unchanged) |
| `400 VALIDATION_FAILED`, *"Payment method is not active."* or *"The selected payment method is not available for this order."* | `400 ORDER_PAYMENT_METHOD_UNAVAILABLE`, no `details.code` | `paymentMethodId` (new) |
| `422 VALIDATION_FAILED`, `details: { code: "order_below_minimum", minimum, subtotal }` (numbers) | `422 ORDER_BELOW_MINIMUM_VALUE` | `minimum`, `subtotal` as two-decimal **strings**, and `currency`; `details.code` is gone |
| `409 VALIDATION_FAILED`, *"Commenting is closed for completed or cancelled orders."* | `409 ORDER_COMMENTS_CLOSED` | `orderId` |
| `409 VALIDATION_FAILED`, *"Order has no line items to clone."* | `409 ORDER_CLONE_NO_LINES` | `orderId` |
| `503 VALIDATION_FAILED`, *"Quote Requests module is not available."* | `503 MODULE_DISABLED` | `module: "quote_requests"` |

The method refusals are answered by `POST /api/v1/orders`, `POST /api/v1/orders/preview-total`,
`POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview`, `POST /api/v1/external/orders`
and every other caller of order placement; the minimum order value by placement (checkout and
admin create); the comment refusal by `POST /api/v1/orders/:id/comments` and
`POST /api/v1/admin/orders/:id/comments`; the two clone refusals by both clone-to-quote routes.
The `details.code` tokens of the method refusals are unchanged, and each now picks its own
sentence. The five new codes are members of `ERROR_CODES` in `@endora-commerce/contracts`,
declared by the `orders` manifest; the `delivery_methods` and `payment_methods` documentation
pages name the new codes. No setting, permission or migration changes.
