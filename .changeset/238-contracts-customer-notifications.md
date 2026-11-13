---
'@endora-commerce/contracts': minor
---

Contracts for quote request notification delivery and the buyer's notification centre (issue #238, `specs/179-rfq-and-customer-notifications/`). Additive only; nothing existing changes shape.

- New `customer-notifications.ts`, exported from the barrel: the `customerNotificationRecordPort` types (`CustomerNotificationRecordPort<EM>` with `record` / `recordWithin`, `RecordCustomerNotificationInput`, `CustomerNotificationMessage`, `CustomerNotificationRecord`) and the storefront API schemas `customerNotificationSchema` (strict), `customerNotificationListResponseSchema` and `customerNotificationUnreadCountResponseSchema`, with their inferred types.
- `pwa.ts`: the `customerPushPort` types — `CustomerPushPort`, `CustomerPushInput`, `CustomerPushCategory` (`'quote'`) and `CustomerPushOutcome`.
- `quote-requests.ts`: `quoteRequestDeliverySchema` (strict) with `quoteRequestDeliveryChannelSchema` and `quoteRequestDeliveryStatusSchema`, and an optional `deliveries` array on `quoteRequestHistoryEntrySchema`. A consumer that builds or reads history entries is unaffected; the field is only ever present on the admin history route.
