---
'@endora-commerce/mod-carts': minor
---

The cart abandonment sweep now runs on its own schedule (issue #1119). Before, it ran only when an operator scheduled `pnpm run cli carts abandonment-sweep` with cron. Now `carts` installs a BullMQ Job Scheduler, `carts.abandonment.sweep`, that fires every 15 minutes (`CART_ABANDONMENT_SWEEP_EVERY_MS`). The scheduler is installed in every process that runs queue consumers. The consumer is attached through `ctx.worker`, so no tick runs while `carts` is unavailable on the platform. A tick first asks `CartAbandonmentWorker.hasSweepWork()` whether any cart is due, without a tenant scope. It enters the system scope and runs `CartAbandonmentWorker.sweepInScope()` only when a cart is due, so an idle instance writes no `tenant.escape_hatch` audit row. `sweep()` keeps its behaviour and is still what the command runs, for a manual pass.

The package now declares `bullmq` (`^5`) as a peer dependency. An instance that already used `carts abandonment-sweep` in cron can remove that cron entry.
