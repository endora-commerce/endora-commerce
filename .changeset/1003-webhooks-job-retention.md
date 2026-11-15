---
'@endora-commerce/mod-webhooks': patch
---

Finished `webhook.deliver` jobs are removed from Redis by age, in line with the delivery-history retention window `webhooks.delivery_retention_days` (issue #1003). A job carries the event's payload and the subscription's signing secret, and until now the queue bounded its finished jobs by count only (500 completed, 5 000 failed), so on a quiet instance they stayed in Redis indefinitely.

- `webhookJobRetention(retentionDays)` (in `services/webhook-queue.ts`) returns the `removeOnComplete` / `removeOnFail` options: the window as `age`, with the count bounds kept. `createWebhookQueue` uses it with the default window as the queue's default job options.
- The event bridge reads the window once per event and passes it on every job it enqueues, so a changed setting applies to the next job. `EventBridgeOptions.retentionDays` is optional; without it the default window applies.
- BullMQ applies `age` only when another job finishes, so the daily retention tick also removes the completed and failed jobs past the window. `WebhookDeliveryRetentionService` takes the delivery queue as an optional third argument, and `purge()` now answers `{ retentionDays, deleted, jobsRemoved }`.
