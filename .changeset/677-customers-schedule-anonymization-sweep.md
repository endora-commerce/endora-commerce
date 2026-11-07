---
'@endora-commerce/mod-customers': patch
---

Soft-deleted customer accounts are now anonymized once `customers.deletion_retention_days` has elapsed (issue #677). `AnonymizationSweepWorker.sweep()` had no caller, so a deleted account kept its personal data indefinitely and `customer_account.anonymized.v1` was never announced. The module now installs a daily BullMQ Job Scheduler (`customers.anonymization.sweep`, idempotent across restarts and replicas) and consumes it through `ctx.worker` in processes that run workers, so no run happens while `customers` is off. On the first worker boot after upgrading, every account already past its window is anonymized.
