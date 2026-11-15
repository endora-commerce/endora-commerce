---
'@endora-commerce/mod-google-analytics': patch
---

Finished `google_analytics.ss.deliver` jobs are removed from Redis by age (issue #1248). A job carries the visitor's `clientId` and the event's `params`, and until now the queue bounded its finished jobs by count only (500 completed, 5 000 failed), so on a quiet instance they stayed in Redis indefinitely.

- `GA_DELIVERY_KEEP_COMPLETED` (one hour, 500 jobs) and `GA_DELIVERY_KEEP_FAILED` (three days, 5 000 jobs), exported from `services/ss-delivery-queue.ts`, are the `removeOnComplete` / `removeOnFail` default job options of the queue `createGaDeliveryQueue` builds.
- BullMQ applies `age` only when another job finishes, so a new hourly Job Scheduler on the queue `google_analytics.ss.deliver.sweep` (`services/ss-delivery-sweep.ts`) removes the completed and failed delivery jobs past those bounds. It runs where the delivery consumer runs, through `ctx.worker`, so no sweep runs while the module is off.
