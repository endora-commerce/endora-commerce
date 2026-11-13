---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-webhooks': patch
---

Webhook admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `webhookListResponseSchema` / `WebhookListResponse` for `GET /api/v1/admin/webhooks`, `createWebhookResponseSchema` / `CreateWebhookResponse` for `POST /api/v1/admin/webhooks` (the subscription plus its signing secret, answered this once), `webhookDeliveryListResponseSchema` / `WebhookDeliveryListResponse` for `GET /api/v1/admin/webhooks/deliveries`, and `webhookEventTypeListResponseSchema` / `WebhookEventTypeListResponse` for `GET /api/v1/admin/webhooks/event-types`. The rows were already described, but these envelopes were not.
- `mod-webhooks` builds every subscription and delivery reply as the contract's `Webhook` / `WebhookDelivery` instead of `Record<string, unknown>`, and each handler declares its reply type. The admin Webhooks page uses the contract types instead of hand-written interfaces. Nothing on the wire changes.
