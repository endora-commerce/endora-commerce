---
'@endora-commerce/mod-google-tag-manager': patch
---

Finished `google_tag_manager.ss.relay` jobs are removed from Redis by age (issue #1248). A job carries the visitor's `clientId`, the event's `params`, the page context and, with consent, the IP address and user agent, and until now the queue bounded its finished jobs by count only (500 completed, 5 000 failed), so on a quiet instance they stayed in Redis indefinitely.

- `GTM_RELAY_KEEP_COMPLETED` (one hour, 500 jobs) and `GTM_RELAY_KEEP_FAILED` (three days, 5 000 jobs), exported from `services/ss-relay-queue.ts`, are the `removeOnComplete` / `removeOnFail` default job options of the queue `createGtmRelayQueue` builds. Three days keeps an exhausted relay observable long enough to diagnose it.
- BullMQ applies `age` only when another job finishes, so a new hourly Job Scheduler on the queue `google_tag_manager.ss.relay.sweep` (`services/ss-relay-sweep.ts`) removes the completed and failed relay jobs past those bounds. It runs where the relay consumer runs, through `ctx.worker`, so no sweep runs while the module is off.
