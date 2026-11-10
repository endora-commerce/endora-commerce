---
'@endora-commerce/mod-webhooks': minor
---

`webhook_deliveries` gets a retention window (issue #928). A new platform-wide setting, `webhooks.delivery_retention_days` (number, default 365, read as the default outside 1–3650 whole days), and a daily BullMQ Job Scheduler (`webhooks.delivery-retention`, attached through `ctx.worker` where `webhooksRunWorkers` is true, so no tick runs while the module is off) delete every `succeeded`, `failed` or `dead_lettered` delivery row created before the window, with its payload and the receiver's response. `pending` and `in_flight` rows are never deleted. A deleted row can no longer be replayed. The module now declares `zod` as a peer dependency, for the setting's read.
