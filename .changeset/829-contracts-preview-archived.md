---
'@endora-commerce/contracts': minor
---

`ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` (and so `adminOrderPreviewMessageCodeSchema` and `AdminOrderPreviewMessageCode`) gains `PRODUCT_ARCHIVED`, second, after `PRODUCT_NOT_FOUND` and before `PRODUCT_NOT_VISIBLE_TO_CUSTOMER`. It equals `ERROR_CODES.PRODUCT_ARCHIVED`. A consumer that takes the codes by position (`const [NOT_FOUND, NOT_VISIBLE] = ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE`) must name them instead, or insert the new one; a consumer switching exhaustively over `AdminOrderPreviewMessageCode` has one more case. `adminOrderPreviewResponseSchema.messages[].code` stays a plain string.
